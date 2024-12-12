import { fileURLToPath } from 'node:url';
import path, { dirname } from 'path';
import { createTunnel } from '../src/index';

// 正确设置本地dist文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 获取远程服务器配置信息 此处建议通过配置文件获取
const sshOptions = {
	host: '192.168.4.70',
	username: 'root',
	password: 'xxxxxx',
};

const host = '0.0.0.0';
const ports = [3306, 888, 9200];
await createTunnel(
	sshOptions,
	ports.map((port) => ({ srcPort: port, dstPort: port, srcAddr: host, dstAddr: host })),
	{ autoClose: false, reconnectOnError: true }
);
console.log('ssh tunnel created');
