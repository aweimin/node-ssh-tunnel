import { createTunnel } from '../src/index';

// Manual smoke script: supply credentials via environment variables.
const password = process.env.SSH_PASSWORD;
if (!password) {
	throw new Error('Set SSH_PASSWORD before running this manual script');
}

const sshOptions = {
	host: process.env.SSH_HOST ?? 'localhost',
	username: process.env.SSH_USERNAME ?? 'root',
	password,
};

const host = process.env.SSH_LISTEN_HOST ?? '0.0.0.0';
const ports = [3306, 888, 9200];

await createTunnel(
	sshOptions,
	ports.map((port) => ({ srcPort: port, dstPort: port, srcAddr: host, dstAddr: host })),
	{ autoClose: false, reconnectOnError: true }
);

console.log('ssh tunnel created');
