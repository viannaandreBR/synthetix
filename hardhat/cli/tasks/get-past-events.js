require('dotenv').config();

const program = require('commander');
const { red } = require('chalk');

const { getContract } = require('../utils/getContract');
const { setupProvider } = require('../utils/setupProvider');
const { getPastEvents } = require('../utils/getEvents');

async function pastEvents({
	network,
	useOvm,
	providerUrl,
	contractName,
	sourceName,
	eventName,
	fromBlock,
	toBlock,
	dedup,
}) {
	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Input ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	if (!providerUrl && process.env.PROVIDER_URL) {
		const envProviderUrl = process.env.PROVIDER_URL;
		if (envProviderUrl.includes('infura')) {
			providerUrl = process.env.PROVIDER_URL.replace('network', network);
		} else {
			providerUrl = envProviderUrl;
		}
	}
	if (!providerUrl) throw new Error('Cannot set up a provider.');

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~ Setup ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	const { provider } = await setupProvider({ providerUrl });

	const contract = await getContract({
		contract: contractName,
		source: sourceName || contractName,
		network,
		useOvm,
		provider,
	});

	/* ~~~~~~~~~~~~~~~~~~~ */
	/* ~~~~~~~ Logs ~~~~~~ */
	/* ~~~~~~~~~~~~~~~~~~~ */

	const events = await getPastEvents({ contract, eventName, provider, fromBlock, toBlock });

	console.log(
		'events',
		await Promise.all(
			events.map(evt =>
				provider
					.getTransaction(evt.transactionHash)
					.then(receipt => Object.assign(evt, { receipt }))
			)
		)
	);

	let count = events.length;
	if (dedup) {
		count = 0;

		const temp = [];
		for (const event of events) {
			const value = event.values[dedup];

			if (temp.indexOf(value) === -1) {
				temp.push(value);
				count++;
			}
		}
	}

	console.log(`Found ${count} "${eventName || '*'}" events.`);
}

program
	.description('Query past emitted events on a contract')
	.option('-c, --contract-name <value>', 'The contract to look for events in')
	.option('-d, --dedup <value>', 'Specify a key to use to remove duplicates from total count')
	.option(
		'-e, --event-name <value>',
		'The event to look for. Will look for all events if not specified'
	)
	.option('-f, --from-block <value>', 'Starting block for the query')
	.option('-n, --network <value>', 'The network to run off', x => x.toLowerCase(), 'mainnet')
	.option(
		'-p, --provider-url <value>',
		'The http provider to use for communicating with the blockchain'
	)
	.option(
		'-s, --source-name <value>',
		'The source abi to use (defaults to contract name if not specified)'
	)
	.option('-t, --to-block <value>', 'Ending block for the query', 'latest')
	.option('-z, --use-ovm', 'Use an Optimism chain', false)
	.action(async (...args) => {
		try {
			await pastEvents(...args);
		} catch (err) {
			console.error(red(err));
			console.log(err.stack);

			process.exitCode = 1;
		}
	});

program.parse(process.argv);
