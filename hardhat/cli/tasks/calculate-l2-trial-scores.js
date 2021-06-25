const fs = require('fs');
const path = require('path');
const { wrap } = require('../../..');
const program = require('commander');
const ethers = require('ethers');
const { gray, red } = require('chalk');
const { getPastEvents } = require('../utils/getEvents');
const { getContract } = require('../utils/getContract');

async function calculateScores({ providerUrl, outputFile }) {
	// Validate input parameters
	if (!providerUrl) throw new Error('Please specify a provider');
	if (!outputFile) throw new Error('Please specify a JSON output file');

	// Retrieve the output data file
	// Create the file if it doesn't exist
	let data;
	if (fs.existsSync(outputFile)) {
		data = JSON.parse(fs.readFileSync(outputFile));
	} else {
		data = {
			totals: {
				totalEscrowedSNX: '0',
				accountsThatWithdrew: '0',
				withdrawals: '0',
				escrowedBalancesChecked: '0',
			},
			accounts: {},
		};
	}

	// Setup common constants
	const network = 'goerli';
	const useOvm = true;
	const contract = 'SynthetixBridgeToBase';
	const eventName = 'WithdrawalInitiated';

	// Setup the provider
	let provider;
	if (providerUrl) {
		provider = new ethers.providers.JsonRpcProvider(providerUrl);
	} else {
		// eslint-disable-next-line new-cap
		provider = new ethers.getDefaultProvider();
	}

	// Get a list of SynthetixBridgeToBase versions that emit WithdrawalInitiated events
	const { getVersions, getSource } = wrap({ network, useOvm, fs, path });
	const versions = getVersions({ network, useOvm, byContract: true, fs, path })[contract];

	// Look for WithdrawalInitiated events on all SynthetixBridgeToBase versions
	console.log(
		gray(
			`1) Looking for WithdrawalInitiated events in ${versions.length} versions of SynthetixBridgeToBase...`
		)
	);
	let allEvents = [];
	for (let i = 0; i < versions.length; i++) {
		// Get version
		const version = versions[i];
		console.log(gray(`  > Version ${i}:`));
		console.log(gray(`    > release: ${version.release}`));
		console.log(gray(`    > tag: ${version.tag}`));
		console.log(gray(`    > commit: ${version.commit}`));
		console.log(gray(`    > date: ${version.date}`));
		console.log(gray(`    > address: ${version.address}`));

		// Connect to the version's SynthetixBridgeToBase contract
		const source = getSource({ contract, network, useOvm });
		const SynthetixBridgeToBase = new ethers.Contract(version.address, source.abi, provider);

		// Fetch WithdrawalInitiated events emitted from the contract
		const events = await getPastEvents({
			contract: SynthetixBridgeToBase,
			eventName,
			provider,
		});
		console.log(gray(`    > events found: ${events.length}`));

		allEvents = allEvents.concat(events);
	}

	// Retrieve all addresses that initiated a withdrawal
	const withdrawals = allEvents.map(event => {
		return {
			account: event.args.account,
			amount: event.args.amount,
		};
	});
	data.totals.withdrawals = withdrawals.length;
	fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

	// Connect to the RewardEscrow contract
	const RewardEscrow = getContract({
		contract: 'RewardEscrow',
		provider,
		network,
		useOvm,
	});

	// Read escrowed SNX amount for each account, and store it in the data file
	console.log(gray(`2) Checking escrowed SNX for each withdrawal event...`));
	for (let i = 0; i < data.totals.withdrawals; i++) {
		const account = withdrawals[i].account;
		console.log(gray(`  > Withdrawal ${i + 1}/${data.totals.withdrawals} - ${account}`));

		// Create entry for account
		let accountData;
		if (data.accounts[account]) accountData = data.accounts[account];
		else
			accountData = {
				escrowedSNX: '0',
				distributedSNX: '0',
			};

		// Only read escrow balance if there is no entry for this account
		if (!data.accounts[account]) {
			const escrowed = await RewardEscrow.balanceOf(account);
			console.log(gray(`    ⮑  Escrowed: ${ethers.utils.formatEther(escrowed)} SNX`));
			data.totals.escrowedBalancesChecked++;
			accountData.escrowedSNX = escrowed.toString();
			data.totals.totalEscrowedSNX = ethers.BigNumber.from(data.totals.totalEscrowedSNX)
				.add(escrowed)
				.toString();
		}

		data.accounts[account] = accountData;
		data.totals.accountsThatWithdrew = Object.keys(data.accounts).length;

		// Store the data immediately
		fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));
	}
}

program
	.description('Calculates L2 trial scores and outputs them in a JSON file')
	.option('--output-file <value>', 'The json file where all output will be stored')
	.option(
		'--provider-url <value>',
		'The http provider to use for communicating with the blockchain'
	)
	.action(async (...args) => {
		try {
			await calculateScores(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
