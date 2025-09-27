module.exports = async (depotId) => {
	console.log(`Depot key was not supplied, attempting to fetch it...`);
	const depotkeys = await fetch("https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/refs/heads/main/depotkeys.json").then(x => x.json());
	if (!depotkeys[depotId]) {
		console.log(`Failed to get the depot key. Please provide it manually.`);
		process.exit(1);
	}
	return depotkeys[depotId];
};
