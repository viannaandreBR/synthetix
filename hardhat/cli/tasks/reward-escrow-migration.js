require('dotenv').config();

const fs = require('fs');
const path = require('path');
const program = require('commander');
const ethers = require('ethers');
const { formatEther, parseUnits } = ethers.utils;
const { red, gray, yellow, green } = require('chalk');
const synthetix = require('../../..');
const { sendTx, confirmTx } = require('../utils/runTx');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');
const { getPastEvents } = require('../utils/getEvents');

async function rewardEscrowMigration({
	accountJson,
	network,
	providerUrl,
	dryRun,
	useFork,
	privateKey,
	gasPrice,
}) {
	console.log(gray(`Running in network: ${network}`));

	const { getUsers } = synthetix.wrap({
		network,
		fs,
		path,
	});

	let publicKey;

	if (useFork) {
		providerUrl = 'http://localhost:8545';
		if (!privateKey) {
			publicKey = getUsers({ user: 'owner' }).address;
		}
	} else if (!providerUrl && process.env.PROVIDER_URL) {
		const envProviderUrl = process.env.PROVIDER_URL;
		if (envProviderUrl.includes('infura')) {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		} else {
			providerUrl = envProviderUrl;
		}
	}

	if (!privateKey && process.env.PRIVATE_KEY) {
		privateKey = process.env.PRIVATE_KEY;
	}

	if (!providerUrl) throw new Error('Cannot set up a provider.');

	const { wallet, provider } = await setupProvider({ providerUrl, privateKey, publicKey });

	console.log(gray('Using wallet with address'), yellow(wallet.address));

	const oldRewardEscrow = await getContract({
		contract: 'RewardEscrow',
		network,
		provider,
	});

	let accounts;

	if (network === 'mainnet') {
		if (!accountJson) {
			throw new Error('AccountJSON is required when on mainnet');
		}

		accounts = JSON.parse(fs.readFileSync(accountJson));
		console.log(gray('Loaded'), yellow(accounts.length), gray('accounts'));
	} else {
		const vestingEntryEvents = await getPastEvents({
			contract: oldRewardEscrow,
			eventName: 'VestingEntryCreated',
			network,
			provider: new ethers.providers.JsonRpcProvider(
				process.env.PROVIDER_URL.replace('network', network)
			), // can't use a fork to load events for some reason
		});

		accounts = Array.from(new Set(vestingEntryEvents.map(({ args: [address] }) => address))).map(
			address => ({
				address,
			})
		);
		console.log(gray('Found'), yellow(accounts.length), gray('accounts'));
	}

	const executeTxn = async ({ txPromise }) => {
		console.log(gray(`  > Staging transaction... ${new Date()}`));
		let result = await sendTx({
			txPromise,
			provider,
		});

		if (result.success) {
			console.log(gray(`  > Sending transaction... ${result.tx.hash}`));

			result = await confirmTx({
				tx: result.tx,
				provider,
			});

			if (result.success) {
				console.log(green('Success. Gas used', result.success.receipt));
			} else {
				throw new Error(`Cannot transact. Reason: "${result.error.reason}"`);
			}
		} else {
			throw new Error(`Cannot stage: ${result.error}`);
		}
	};

	const newRewardEscrow = await getContract({
		contract: 'RewardEscrowV2',
		network,
		wallet,
	});

	const overrides = {
		gasPrice: parseUnits(gasPrice, 'gwei'),
		gasLimit: 10e6,
	};

	const accountsWithDetail = [];
	for (let { address, balanceOf, vestedBalanceOf } of accounts) {
		const alreadyEscrowed = +(await newRewardEscrow.totalEscrowedAccountBalance(address)) > 0;

		if (alreadyEscrowed) {
			console.log(
				gray('Note:'),
				yellow(address),
				gray('escrow amounts already exist. It will NOT be added to the migrate call.')
			);
		}

		if (network !== 'mainnet') {
			[balanceOf, vestedBalanceOf] = await Promise.all([
				oldRewardEscrow.totalEscrowedAccountBalance(address),
				oldRewardEscrow.totalVestedAccountBalance(address),
			]);
		}

		accountsWithDetail.push({
			address,
			balance: balanceOf.toString(),
			vested: vestedBalanceOf.toString(),
			hasEscrowBalance: alreadyEscrowed,
		});
	}

	const migrationPageSize = 450;
	const accountsToMigrate = accountsWithDetail.filter(({ hasEscrowBalance }) => !hasEscrowBalance);

	const output = { migratedAccounts: [], importedVestedEntries: [] };

	// Do the migrateAccountEscrowBalances() in large batches
	for (let i = 0; i < accountsToMigrate.length; i += migrationPageSize) {
		const accounts = accountsToMigrate.slice(i, i + migrationPageSize);
		console.log(gray('Migrating'), yellow(accounts.length), gray('accounts'));
		output.migratedAccounts = output.migratedAccounts.concat(accounts);
		if (!dryRun) {
			await executeTxn({
				txPromise: newRewardEscrow.migrateAccountEscrowBalances(
					accounts.map(({ address }) => address),
					accounts.map(({ balance }) => balance),
					accounts.map(({ vested }) => vested),
					overrides
				),
			});
		}
	}

	const migrationThreshold = formatEther(await newRewardEscrow.migrateEntriesThresholdAmount());

	console.log(
		gray('Now flattening entries of expired vesting entries for all accounts over'),
		yellow(migrationThreshold),
		gray('in escrowed SNX')
	);

	const { number: latestBlock, timestamp: latestBlockTimestamp } = await provider.getBlock(
		await provider.getBlockNumber()
	);

	console.log(
		gray('Latest block'),
		yellow(latestBlock),
		gray('with timestamp of'),
		yellow(latestBlockTimestamp)
	);

	// now get all accounts with > migrationThreshold
	const accountsWithOverMigrationThreshold = accountsWithDetail.filter(
		({ balance }) => formatEther(balance) > migrationThreshold
	);

	// and prepare a list of accounts with entries past vesting date
	const accountsWithFlattenedEntriesPastVestingDate = [];

	// for all accouts over the threshold
	for (const { address } of accountsWithOverMigrationThreshold) {
		const numVestingEntriesAlreadyImported = +(await newRewardEscrow.numVestingEntries(address));

		// make sure not yet run
		if (numVestingEntriesAlreadyImported > 0) {
			console.log(
				gray('Address'),
				yellow(address),
				gray('already has'),
				yellow(numVestingEntriesAlreadyImported),
				gray('entries imported. SKipping')
			);
			continue;
		}

		// begin a tally
		let entrySumThatArePastVestingDate = ethers.BigNumber.from(0);

		// load their old schedules
		const flatSchedule = await oldRewardEscrow.checkAccountSchedule(address);

		// and loop over them
		for (let i = 0; i < flatSchedule.length; i += 2) {
			const [timestamp, entry] = flatSchedule.slice(i).map(_ => _.toString());
			if (timestamp === '0' && entry === '0') {
				// skip 0 entries
				continue;
			} else if (+timestamp > +latestBlockTimestamp) {
				// skip entries that haven't hit their vesting date
				continue;
			} else if (timestamp === '0' || entry === '0') {
				// warn on bad data and skip
				console.log(
					red('Warning: address'),
					yellow(address),
					red('has'),
					yellow(timestamp, entry),
					red('One is 0. Skipping')
				);
				continue;
			}
			// otherwise add to the sum
			entrySumThatArePastVestingDate = entrySumThatArePastVestingDate.add(flatSchedule[i + 1]);
		}

		if (entrySumThatArePastVestingDate.gt(0)) {
			accountsWithFlattenedEntriesPastVestingDate.push({
				address,
				amount: entrySumThatArePastVestingDate.toString(),
			});
		}
	}

	console.log(
		gray('There are'),
		yellow(accountsWithFlattenedEntriesPastVestingDate.length),
		gray('accounts with vested entries flattened to import')
	);

	const importPageSize = 350;

	// Do the importVestingSchedule() in large batches
	for (let i = 0; i < accountsWithFlattenedEntriesPastVestingDate.length; i += importPageSize) {
		const accounts = accountsWithFlattenedEntriesPastVestingDate.slice(i, i + importPageSize);
		console.log(gray('Importing'), yellow(accounts.length), gray('accounts'));
		output.importedVestedEntries = output.importedVestedEntries.concat(accounts);
		if (!dryRun) {
			await executeTxn({
				txPromise: newRewardEscrow.importVestingSchedule(
					accounts.map(({ address }) => address),
					accounts.map(({ amount }) => amount),
					overrides
				),
			});
		}
	}

	fs.writeFileSync(
		`rewards-out-${network}-${latestBlockTimestamp}.json`,
		JSON.stringify(output, null, 2)
	);

	const newTotalBalance = +(await newRewardEscrow.totalEscrowedBalance());
	const oldTotalBalance = +(await oldRewardEscrow.totalEscrowedBalance());

	if (newTotalBalance !== oldTotalBalance) {
		console.log(
			red('Error: total mismatch'),
			yellow(newTotalBalance),
			red('versus older'),
			yellow(oldTotalBalance)
		);
	} else {
		console.log(
			gray('Totals match'),
			yellow(formatEther(newTotalBalance)),
			yellow(formatEther(oldTotalBalance))
		);
	}
}

program
	.description('Reward Escrow Migration')
	.option('-a, --account-json <value>', 'The account json file')
	.option('-f, --use-fork', 'Use a local fork', false)
	.option('-g, --gas-price <value>', 'Gas price to set when performing actions', 1)
	.option('-k, --private-key <value>', 'Private key to use to sign txs')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option(
		'-p, --provider-url <value>',
		'The http provider to use for communicating with the blockchain'
	)
	.option('-r, --dry-run', 'Run as a dry-run', false)
	.action(async (...args) => {
		try {
			await rewardEscrowMigration(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
