import { ListenOptions, Server, Socket, createServer } from 'net';
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

	/**
	 * If set to true, when ssh connection is broken, the tunnel will be re-created.
	 * @default false
	 */
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

const createLocalServer = async (options: ListenOptions) => {
	let serverOptions: any = Object.assign({}, options);

	if (!serverOptions.port && !serverOptions.host) {
		serverOptions = null;
	}

	return new Promise<Server>((resolve, reject) => {
		let server = createServer();
		let errorHandler = (error: any) => {
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
	return new Promise<Client>((resolve, reject) => {
		let conn = new Client();
		conn.on('ready', () => {
			conn.removeListener('error', reject);
			resolve(conn);
		});
		conn.on('error', (error) => {
			reject(error);
		});
		conn.connect(config);
	});
};
const reCreateSSHConnection = async (config: SshOptions) => {
	return new Promise<Client>(async (resolve, reject) => {
		try {
			console.log('ReCreateSSHConnection');
			const conn = await createSSHConnection(config);
			resolve(conn);
		} catch (e) {
			setTimeout(() => {
				resolve(reCreateSSHConnection(config));
			}, 1000);
		}
	});
};
export class SSHError extends Error {
	private code: string | undefined;
	constructor(message: string, code?: string) {
		super(message);
		this.code = code;
	}
}
export class NodeSSHTunnel {
	private connection: Client | null;
	private sshOptions: SshOptions | null;
	private servers: (Server | undefined)[] | null;
	constructor() {
		this.connection = null;
		this.sshOptions = null;
		this.servers = null;
	}
	getConnection() {
		const { connection } = this;
		if (connection === null) {
			throw new Error('Not connected to server');
		}
		return connection;
	}
	isConnected() {
		return this.connection != null;
	}
	async connect(sshOptions: SshOptions) {
		const sshOptionslocal = Object.assign({ port: 22, username: 'root' }, sshOptions);
		const connection = new Client();

		await new Promise((resolve, reject) => {
			connection.on('error', reject);
			connection.on('ready', () => {
				this.connection = connection;
				connection.removeListener('error', reject);
				resolve(true);
			});
			connection.on('end', () => {
				if (this.connection === connection) {
					this.connection = null;
				}
			});
			connection.on('close', () => {
				if (this.connection === connection) {
					this.connection = null;
				}
				reject(new SSHError('No response from server', 'ETIMEDOUT'));
			});
			connection.connect(sshOptionslocal);
		});
		return this;
	}
	async reConnect() {
		return new Promise<Client>(async (resolve, reject) => {
			try {
				console.log('ReCreateSSHConnection');
				const conn = await createSSHConnection(this.sshOptions as SshOptions);
				resolve(conn);
			} catch (e) {
				setTimeout(() => {
					resolve(reCreateSSHConnection(this.sshOptions as SshOptions));
				}, 1000);
			}
		});
	}
	async close() {
		const { connection } = this;
		if (connection !== null) {
			try {
				connection.removeAllListeners();
				connection.end();
				connection.destroy();
			} catch (e) {
				console.log(e);
			}
			this.connection = null;
		}
		this.servers?.forEach((server) => {
			if (server) {
				try {
					server.close();
				} catch (e) {
					console.log(e);
				}
			}
		});
		this.servers = null;
	}

	async createTunnel(forwardOptions: ForwardOptions | ForwardOptions[], tunnelOptions?: TunnelOptions) {
		if (this.connection === null) {
			throw new Error('Not connected to server');
		}
		if (this.servers !== null) {
			throw new Error('Tunnel already created');
		}
		this.connection.on('error', async (error) => {
			if (tunnelOptionsLocal.reconnectOnError) {
				console.log('ReconnectOnError');
				this.connection = await this.reConnect();
			} else {
				console.log('Error');
				console.log(error);
			}
		});
		const forwardOptionsArray = Array.isArray(forwardOptions) ? forwardOptions : [forwardOptions];
		const forwardOptionsLocal = forwardOptionsArray.map((item) => {
			return Object.assign({ dstAddr: '127.0.0.1', srcAddr: '0.0.0.0' }, item);
		});
		const tunnelOptionsLocal = Object.assign({ autoClose: false, reconnectOnError: true }, tunnelOptions || {});
		this.servers = await Promise.all(
			forwardOptionsLocal.map(async (item) => {
				const serverOptions: ListenOptions = { host: item.srcAddr, port: item.srcPort };
				let server: Server;

				const onConnectionHandler = (clientConnection: Socket, num = 0) => {
					if (this.getConnection() !== null) {
						const sshConnection = this.getConnection();
						try {
							sshConnection.forwardOut(
								clientConnection.remoteAddress ?? item.srcAddr,
								clientConnection.remotePort ?? item.srcPort,
								item.dstAddr,
								item.dstPort,
								(err, stream) => {
									if (err) {
										console.log(err.message);
										clientConnection.on('close', () => {});
										clientConnection.on('error', () => {});
										try {
											clientConnection.end();
											clientConnection.destroy();
										} catch (e) {
											console.log(e);
										}
									} else {
										clientConnection.on('close', () => {
											stream.end();
										});
										clientConnection.on('error', () => {
											stream.end();
										});
										clientConnection.pipe(stream).pipe(clientConnection);
									}
								}
							);
						} catch (e) {
							clientConnection.on('close', () => {});
							clientConnection.on('error', () => {});
							try {
								clientConnection.end();
								clientConnection.destroy();
							} catch (e) {
								console.log(e);
							}
						}
					} else if (num < 20) {
						setTimeout(() => {
							onConnectionHandler(clientConnection, num + 1);
						}, 500);
					} else {
						try {
							clientConnection.end();
							clientConnection.destroy();
						} catch (e) {
							console.log(e);
						}
					}
				};
				try {
					server = await createLocalServer(serverOptions);
					console.log(
						'create tunel success: ',
						`${item.srcAddr}:${item.srcPort} => ${this.sshOptions?.host}:${item.dstPort}`
					);
					server.on('connection', onConnectionHandler);
					return server;
				} catch (e) {
					console.log(e);
					return undefined;
				}
			})
		);
	}
	async disconnect() {
		this.close();
	}
}
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

	const tunnelOptionsLocal = Object.assign({ autoClose: false, reconnectOnError: true }, tunnelOptions || {});

	let sshConnection: Client | undefined;
	const addListenerSshConnection = (sshConnection_: Client) => {
		if (tunnelOptionsLocal.reconnectOnError) {
			sshConnection_.on('error', async () => {
				sshConnection = undefined;
				// sshConnection.isBroken = true;
				console.log('sshConnection', 'error');
				sshConnection = await reCreateSSHConnection(sshOptionslocal);
				addListenerSshConnection(sshConnection);
				console.log('sshConnection', 'reconnected');
			});
			sshConnection_.on('close', async () => {
				// sshConnection.isBroken = true;
				//sshConnection = await createSSHConnection(sshOptionslocal);
				//addListenerSshConnection(sshConnection);
			});
		}
	};
	try {
		sshConnection = await createSSHConnection(sshOptionslocal);
		addListenerSshConnection(sshConnection);
	} catch (e) {
		return Promise.reject('用户名或密码错误, 请检查你的配置信息');
	}

	const servers: (Server | undefined)[] = await Promise.all(
		forwardOptionsLocal.map(async (item) => {
			const serverOptions: ListenOptions = { host: item.srcAddr, port: item.srcPort };
			let server: Server;
			const addListenerServer = (server_: Server) => {
				if (tunnelOptionsLocal.reconnectOnError) {
					server_.on('error', async () => {
						server = await createLocalServer(serverOptions);
						addListenerServer(server);
					});
				}
				server_.on('connection', onConnectionHandler);
				server_.on('close', () => {
					// sshConnection.end();
					console.log(
						'close tunel: ',
						`${item.srcAddr}:${item.srcPort} => ${sshOptions.host}:${item.dstPort}`
					);
				});
			};

			const onConnectionHandler = (clientConnection: Socket, num = 0) => {
				if (tunnelOptionsLocal.autoClose) {
					autoClose(server, clientConnection);
				}

				// if (sshConnection.isBroken) {
				// 	return;
				// }
				if (sshConnection) {
					try {
						sshConnection.forwardOut(
							clientConnection.remoteAddress ?? item.srcAddr,
							clientConnection.remotePort ?? item.srcPort,
							item.dstAddr,
							item.dstPort,
							(err, stream) => {
								if (err) {
									// if (server) {
									// 	server.close();
									// }
									// throw err;
									console.log(err.message);
									clientConnection.on('close', () => {});
									clientConnection.on('error', () => {});
									try {
										clientConnection.end();
										clientConnection.destroy();
									} catch (e) {
										console.log(e);
									}
								} else {
									clientConnection.on('close', () => {
										stream.end();
									});
									clientConnection.on('error', () => {
										stream.end();
									});
									clientConnection.pipe(stream).pipe(clientConnection);
								}
							}
						);
					} catch (e) {
						clientConnection.on('close', () => {});
						clientConnection.on('error', () => {});
						try {
							clientConnection.end();
							clientConnection.destroy();
						} catch (e) {
							console.log(e);
						}
					}
				} else if (num < 20) {
					setTimeout(() => {
						onConnectionHandler(clientConnection, num + 1);
					}, 500);
				} else {
					clientConnection.on('close', () => {});
					clientConnection.on('error', () => {});
					try {
						clientConnection.end();
						clientConnection.destroy();
					} catch (e) {
						console.log(e);
					}
				}
			};
			try {
				server = await createLocalServer(serverOptions);
				addListenerServer(server);
				console.log(
					'create tunel success: ',
					`${item.srcAddr}:${item.srcPort} => ${sshOptions.host}:${item.dstPort}`
				);
				return server;
			} catch (e) {
				console.log(e);
				return undefined;
			}
		})
	);
	const close = () => {
		servers.forEach((server) => {
			if (server) {
				try {
					server.close();
				} catch (e) {
					console.log(e);
				}
			}
		});
		if (sshConnection) {
			try {
				sshConnection.end();
				sshConnection.destroy();
			} catch (e) {
				console.log(e);
			}
		}
	};
	return { servers, sshConnection, close };
};
export const createTunnelEx = async (
	sshOptions: SshOptions,
	forwardOptions: ForwardOptions[] | ForwardOptions,
	tunnelOptions?: TunnelOptions
) => {
	const nst = new NodeSSHTunnel();
	await nst.connect(sshOptions);
	await nst.createTunnel(forwardOptions, tunnelOptions);
	return nst;
};

export default createTunnel;
