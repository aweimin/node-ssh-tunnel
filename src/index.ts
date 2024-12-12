import net, { ListenOptions, Server, Socket } from 'net';
import { Client, ConnectConfig } from 'ssh2';

export type SshOptions = ConnectConfig;
/**
 * Controls be behaviour of the tunnel server.
 */
export interface TunnelOptions {
	/*
	 * specifies if the tunnel should close automatically after all clients have disconnected.
	 * useful for cli scripts or any other short lived processes.
	 * @default false
	 */
	autoClose?: boolean;

	reconnectOnError?: boolean;
}

/**
 * If the `srcAddr` or `srcPort` is not defined, the adress will be taken from the local TCP server
 */
export interface ForwardOptions {
	/*
	 * The address or interface we want to listen on.
	 * @default "0.0.0.0"
	 **/
	srcAddr?: string;
	/*
	 * The port or interface we want to listen on.
	 **/
	srcPort: number;
	/*
	 * the address we want to forward the traffic to.
	 * @default "127.0.0.1"
	 **/
	dstAddr?: string;
	/*
	 * the port we want to forward the traffic to.
	 */
	dstPort: number;
}

const autoClose = (server: Server, connection: Socket) => {
	connection.on('close', () => {
		server.getConnections((error, count) => {
			if (count === 0) {
				server.close();
			}
		});
	});
};

const createServer = async (options: ListenOptions) => {
	let serverOptions: any = Object.assign({}, options);

	if (!serverOptions.port && !serverOptions.path) {
		serverOptions = null;
	}

	return new Promise<Server>((resolve, reject) => {
		let server = net.createServer();
		let errorHandler = function (error: any) {
			reject(error);
		};
		server.on('error', errorHandler);
		process.on('uncaughtException', errorHandler);

		server.listen(serverOptions);
		server.on('listening', () => {
			process.removeListener('uncaughtException', errorHandler);
			resolve(server);
		});
	});
};

const createSSHConnection = async (config: SshOptions) => {
	return new Promise<Client>(function (resolve, reject) {
		let conn = new Client();
		conn.on('ready', () => resolve(conn));
		conn.on('error', reject);
		conn.connect(config);
	});
};

export const createTunnel = async (
	sshOptions: SshOptions,
	forwardOptions: ForwardOptions[] | ForwardOptions,
	tunnelOptions?: TunnelOptions
) => {
	const sshOptionslocal = Object.assign({ port: 22, username: 'root' }, sshOptions);
	const forwardOptionsArray = Array.isArray(forwardOptions) ? forwardOptions : [forwardOptions];

	const forwardOptionsLocal = forwardOptionsArray.map((item) => {
		return Object.assign({ dstAddr: '127.0.0.1', srcAddr: '0.0.0.0' }, item);
	});

	const tunnelOptionsLocal = Object.assign({ autoClose: false, reconnectOnError: false }, tunnelOptions || {});

	return new Promise(async function (resolve, reject) {
		let sshConnection: Client;
		try {
			sshConnection = await createSSHConnection(sshOptionslocal);
			addListenerSshConnection(sshConnection);
		} catch (e) {
			return reject(e);
		}
		function addListenerSshConnection(sshConnection: Client) {
			if (tunnelOptionsLocal.reconnectOnError) {
				sshConnection.on('error', async () => {
					// sshConnection.isBroken = true;
					sshConnection = await createSSHConnection(sshOptionslocal);
					addListenerSshConnection(sshConnection);
				});
			}
		}

		const servers = forwardOptionsLocal.map(async (item) => {
			const serverOptions: ListenOptions = { host: item.srcAddr, port: item.srcPort };
			let server: Server;
			try {
				server = await createServer(serverOptions);
				addListenerServer(server);
			} catch (e) {
				return reject(e);
			}

			function addListenerServer(server: Server) {
				if (tunnelOptionsLocal.reconnectOnError) {
					server.on('error', async () => {
						server = await createServer(serverOptions);
						addListenerServer(server);
					});
				}
				server.on('connection', onConnectionHandler);
				server.on('close', () => sshConnection.end());
			}
			console.log(
				'create tunel success: ',
				`${item.srcAddr}:${item.srcPort} => ${sshOptions.host}:${item.dstPort}`
			);

			function onConnectionHandler(clientConnection: Socket) {
				if (tunnelOptionsLocal.autoClose) {
					autoClose(server, clientConnection);
				}

				// if (sshConnection.isBroken) {
				// 	return;
				// }

				sshConnection.forwardOut(item.srcAddr, item.srcPort, item.dstAddr, item.dstPort, (err, stream) => {
					if (err) {
						if (server) {
							server.close();
						}
						throw err;
					} else {
						clientConnection.pipe(stream).pipe(clientConnection);
					}
				});
			}
		});

		resolve({ servers, sshConnection });
	});
};

export default createTunnel;
