import { ListenOptions, Server, Socket, createServer } from 'net';
import { Duplex } from 'node:stream';
import { Client, ConnectConfig } from 'ssh2';

export type SshOptions = ConnectConfig;
export type Logger = Pick<Console, 'log' | 'error'>;

/**
 * Controls the behavior of the tunnel server.
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
	 * @default true
	 */
	reconnectOnError?: boolean;

	/**
	 * Optional logger. Defaults to the global console, preserving previous log output.
	 */
	logger?: Logger;
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
	 * The port we want to listen on. If omitted, the OS picks a free port.
	 **/
	srcPort?: number;
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

interface ReconnectState {
	reconnecting: boolean;
	cancelled: boolean;
	cancelTimer?: () => void;
}

type NormalizedForwardOptions = ForwardOptions & { srcAddr: string; dstAddr: string };
type NormalizedTunnelOptions = {
	autoClose: boolean;
	reconnectOnError: boolean;
	logger: Logger;
};

const normalizeSshOptions = (sshOptions: SshOptions): SshOptions =>
	Object.assign({ port: 22, username: 'root' }, sshOptions);

const normalizeForwardOptions = (
	forwardOptions: ForwardOptions | ForwardOptions[]
): NormalizedForwardOptions[] =>
	(Array.isArray(forwardOptions) ? forwardOptions : [forwardOptions]).map((item) =>
		Object.assign({ dstAddr: '127.0.0.1', srcAddr: '0.0.0.0' }, item)
	);

const normalizeTunnelOptions = (tunnelOptions?: TunnelOptions): NormalizedTunnelOptions =>
	Object.assign({ autoClose: false, reconnectOnError: true, logger: console }, tunnelOptions || {});

const autoClose = (server: Server, connection: Socket) => {
	connection.on('close', () => {
		server.getConnections((_error, count) => {
			if (count === 0 && server.listening) {
				server.close();
			}
		});
	});
};

const createLocalServer = async (options: ListenOptions): Promise<Server> => {
	const serverOptions: ListenOptions = { ...options, port: options.port ?? 0 };

	return new Promise<Server>((resolve, reject) => {
		const server = createServer();
		const errorHandler = (error: Error) => {
			server.removeListener('listening', listeningHandler);
			reject(error);
		};
		const listeningHandler = () => {
			server.removeListener('error', errorHandler);
			resolve(server);
		};

		server.once('error', errorHandler);
		server.once('listening', listeningHandler);

		server.listen(serverOptions);
	});
};

const createSSHConnection = async (config: SshOptions): Promise<Client> =>
	new Promise<Client>((resolve, reject) => {
		const conn = new Client();
		conn.on('ready', () => {
			conn.removeListener('error', reject);
			resolve(conn);
		});
		conn.on('error', reject);
		conn.connect(config);
	});

const waitWithCancel = (ms: number, state: ReconnectState): Promise<void> =>
	new Promise((resolve) => {
		const timer = setTimeout(() => {
			state.cancelTimer = undefined;
			resolve();
		}, ms);
		state.cancelTimer = () => {
			clearTimeout(timer);
			state.cancelTimer = undefined;
			resolve();
		};
	});

const recreateSSHConnection = async (
	config: SshOptions,
	state: ReconnectState,
	logger: Logger
): Promise<Client | null> => {
	if (state.cancelled) {
		return null;
	}

	state.reconnecting = true;
	logger.log('ReCreateSSHConnection');

	let delay = 1000;
	try {
		while (!state.cancelled) {
			try {
				return await createSSHConnection(config);
			} catch (e) {
				if (state.cancelled) {
					break;
				}
				logger.log('ReCreateSSHConnection failed', e instanceof Error ? e.message : e);
				await waitWithCancel(delay, state);
				delay = Math.min(delay * 2, 30000);
			}
		}
		return null;
	} finally {
		state.reconnecting = false;
	}
};

const createSshReconnectAttacher = (
	getConnection: () => Client | null | undefined,
	setConnection: (conn: Client | null | undefined) => void,
	sshOptions: SshOptions,
	tunnelOptionsLocal: NormalizedTunnelOptions,
	state: ReconnectState,
	logger: Logger
) => {
	const attach = (): void => {
		const conn = getConnection();
		if (!conn) {
			return;
		}

		const handle = async (kind: 'error' | 'close', error?: unknown) => {
			conn.removeAllListeners();
			if (getConnection() === conn) {
				setConnection(null);
			}
			logger.log('sshConnection', kind);

			if (state.reconnecting || state.cancelled) {
				return;
			}

			if (tunnelOptionsLocal.reconnectOnError) {
				logger.log('ReconnectOnError', 'start reconnect');
				const newConn = await recreateSSHConnection(sshOptions, state, logger);
				if (!newConn || state.cancelled) {
					return;
				}
				setConnection(newConn);
				attach();
				logger.log('sshConnection', 'reconnected');
			} else if (kind === 'error') {
				logger.log('Error', error);
			} else {
				logger.log('close');
			}
		};

		conn.on('error', (error) => {
			void handle('error', error);
		});
		conn.on('close', () => {
			void handle('close');
		});
	};

	return attach;
};

const destroySocket = (socket: Socket): void => {
	socket.on('error', () => {});
	try {
		socket.end();
		socket.destroy();
	} catch {
		// ignore errors while tearing down a socket
	}
};

const destroyStream = (stream: Duplex): void => {
	stream.on('error', () => {});
	try {
		stream.end();
		stream.destroy();
	} catch {
		// ignore errors while tearing down a stream
	}
};

const createForwardingServers = async (
	forwardOptionsLocal: NormalizedForwardOptions[],
	getConnection: () => Client | null | undefined,
	tunnelOptionsLocal: NormalizedTunnelOptions,
	state: ReconnectState,
	logger: Logger,
	sshOptions: SshOptions
): Promise<(Server | undefined)[]> => {
	const servers: (Server | undefined)[] = new Array(forwardOptionsLocal.length).fill(undefined);

	await Promise.all(
		forwardOptionsLocal.map(async (item, index) => {
			const serverOptions: ListenOptions = {
				host: item.srcAddr,
				...(item.srcPort === undefined ? {} : { port: item.srcPort }),
			};
			const description = `${item.srcAddr}:${item.srcPort ?? 'auto'} => ${sshOptions.host}:${item.dstPort}`;

			const onConnectionHandler = (clientConnection: Socket, num = 0): void => {
				const currentServer = servers[index];
				if (tunnelOptionsLocal.autoClose && currentServer) {
					autoClose(currentServer, clientConnection);
				}

				const connection = getConnection();
				if (connection) {
					try {
						connection.forwardOut(
							clientConnection.remoteAddress ?? item.srcAddr,
							clientConnection.remotePort ?? item.srcPort ?? 0,
							item.dstAddr,
							item.dstPort,
							(err, stream) => {
								if (err) {
									logger.log(err.message);
									destroySocket(clientConnection);
									return;
								}
								stream.on('error', () => destroySocket(clientConnection));
								stream.on('close', () => destroySocket(clientConnection));
								clientConnection.on('close', () => destroyStream(stream));
								clientConnection.on('error', () => destroyStream(stream));
								clientConnection.pipe(stream).pipe(clientConnection);
							}
						);
					} catch (e) {
						logger.log(e);
						destroySocket(clientConnection);
					}
				} else if (!state.cancelled && num < 20) {
					setTimeout(() => onConnectionHandler(clientConnection, num + 1), 500);
				} else {
					destroySocket(clientConnection);
				}
			};

			const addListenerServer = (server: Server): void => {
				server.on('error', async (error) => {
					logger.log(error);
					if (state.cancelled) {
						return;
					}
					if (tunnelOptionsLocal.reconnectOnError) {
						try {
							const newServer = await createLocalServer(serverOptions);
							if (state.cancelled) {
								newServer.close();
								return;
							}
							servers[index] = newServer;
							addListenerServer(newServer);
						} catch (e) {
							logger.log(e);
						}
					}
				});
				server.on('connection', onConnectionHandler);
				server.on('close', () => {
					logger.log('close tunel: ', description);
				});
			};

			try {
				const server = await createLocalServer(serverOptions);
				servers[index] = server;
				addListenerServer(server);
				logger.log('create tunel success: ', description);
			} catch (e) {
				logger.log(e);
			}
		})
	);

	return servers;
};

export class SSHError extends Error {
	readonly code: string | undefined;
	constructor(message: string, code?: string) {
		super(message);
		this.name = 'SSHError';
		this.code = code;
	}
}

export class NodeSSHTunnel {
	private connection: Client | null;
	private sshOptions: SshOptions | null;
	private servers: (Server | undefined)[] | null;
	private logger: Logger = console;
	private reconnectState: ReconnectState = { reconnecting: false, cancelled: false };

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
		const sshOptionslocal = normalizeSshOptions(sshOptions);
		this.sshOptions = sshOptionslocal;
		this.reconnectState.cancelled = false;
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

	async reConnect(): Promise<Client> {
		if (!this.sshOptions) {
			throw new Error('Not connected to server');
		}
		const conn = await recreateSSHConnection(this.sshOptions, this.reconnectState, this.logger);
		if (!conn) {
			throw new Error('Tunnel closed while reconnecting');
		}
		return conn;
	}

	async disconnect() {
		this.reconnectState.cancelled = true;
		this.reconnectState.cancelTimer?.();
		const { connection } = this;
		if (connection !== null) {
			try {
				connection.removeAllListeners();
				connection.end();
				connection.destroy();
			} catch (e) {
				this.logger.log(e);
			}
			this.connection = null;
		}
	}

	async close() {
		await this.disconnect();
		await this.closeTunnel();
	}

	async closeTunnel() {
		if (this.servers !== null) {
			this.servers.forEach((server) => {
				if (server) {
					try {
						server.close();
					} catch (e) {
						this.logger.log(e);
					}
				}
			});
			this.servers = null;
		}
	}

	async createTunnel(
		forwardOptions: ForwardOptions | ForwardOptions[],
		tunnelOptions?: TunnelOptions
	) {
		if (!this.isConnected()) {
			throw new Error('Not connected to server');
		}
		if (this.servers !== null) {
			throw new Error('Tunnel already created');
		}
		if (!this.sshOptions) {
			throw new Error('Not connected to server');
		}

		const tunnelOptionsLocal = normalizeTunnelOptions(tunnelOptions);
		this.logger = tunnelOptionsLocal.logger;
		this.reconnectState.cancelled = false;
		const forwardOptionsLocal = normalizeForwardOptions(forwardOptions);

		const attach = createSshReconnectAttacher(
			() => this.connection,
			(conn) => {
				this.connection = conn ?? null;
			},
			this.sshOptions,
			tunnelOptionsLocal,
			this.reconnectState,
			this.logger
		);
		attach();

		this.servers = await createForwardingServers(
			forwardOptionsLocal,
			() => this.connection,
			tunnelOptionsLocal,
			this.reconnectState,
			this.logger,
			this.sshOptions
		);
	}
}

export const createTunnel = async (
	sshOptions: SshOptions,
	forwardOptions: ForwardOptions[] | ForwardOptions,
	tunnelOptions?: TunnelOptions
) => {
	const sshOptionslocal = normalizeSshOptions(sshOptions);
	const forwardOptionsLocal = normalizeForwardOptions(forwardOptions);
	const tunnelOptionsLocal = normalizeTunnelOptions(tunnelOptions);
	const { logger } = tunnelOptionsLocal;
	const state: ReconnectState = { reconnecting: false, cancelled: false };
	let sshConnection: Client | undefined;

	const attach = createSshReconnectAttacher(
		() => sshConnection,
		(conn) => {
			sshConnection = conn ?? undefined;
		},
		sshOptionslocal,
		tunnelOptionsLocal,
		state,
		logger
	);

	try {
		sshConnection = await createSSHConnection(sshOptionslocal);
		attach();
	} catch (cause) {
		return Promise.reject(
			new Error('用户名或密码错误, 请检查你的配置信息', { cause })
		);
	}

	const servers = await createForwardingServers(
		forwardOptionsLocal,
		() => sshConnection,
		tunnelOptionsLocal,
		state,
		logger,
		sshOptionslocal
	);

	const close = () => {
		state.cancelled = true;
		state.cancelTimer?.();
		servers.forEach((server) => {
			if (server) {
				try {
					server.close();
				} catch (e) {
					logger.log(e);
				}
			}
		});
		if (sshConnection) {
			try {
				sshConnection.removeAllListeners();
				sshConnection.end();
				sshConnection.destroy();
			} catch (e) {
				logger.log(e);
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
