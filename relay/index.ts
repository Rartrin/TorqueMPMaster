import { MPRelayServer } from "./relayserver";

console.log("Starting MP Relay");
let server = new MPRelayServer();
server.initialize();

process.on('exit', () => {
	console.log("Stopping...");
	server.dispose(); // Gracefully shutdown the SQLite connection
});
process.on('SIGHUP', () => process.exit(128 + 1));
process.on('SIGINT', () => process.exit(128 + 2));
process.on('SIGTERM', () => process.exit(128 + 15));