import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import createTunnel, { NodeSSHTunnel, SSHError } from '../src/index';

const mockClients: any[] = [];
const mockServers: any[] = [];
const mockForwardOut = jest.fn();

jest.mock('ssh2', () => {
	const { EventEmitter: EE } = jest.requireActual('node:events');

	class MockClient extends EE {
		forwardOut = mockForwardOut;
		connect = jest.fn();
		end = jest.fn();
		destroy = jest.fn();

		constructor() {
			super();
			mockClients.push(this);
		}
	}

	return { Client: MockClient };
});

jest.mock('net', () => {
	const { EventEmitter: EE } = jest.requireActual('node:events');
	const actual = jest.requireActual('net');

	class MockServer extends EE {
		listening = true;
		close = jest.fn();
		getConnections = jest.fn((cb: (error: Error | null, count: number) => void) => cb(null, 0));
		listen = jest.fn(() => {
			queueMicrotask(() => this.emit('listening'));
			return this;
		});

		constructor() {
			super();
			mockServers.push(this);
		}
	}

	return { ...actual, createServer: jest.fn(() => new MockServer()) };
});

const silentLogger = { log: jest.fn(), error: jest.fn() };

const makeSocket = () => {
	const socket = new EventEmitter() as any;
	socket.remoteAddress = '127.0.0.2';
	socket.remotePort = 12345;
	socket.pipe = jest.fn().mockReturnValue({ pipe: jest.fn() });
	socket.end = jest.fn();
	socket.destroy = jest.fn();
	return socket;
};

beforeEach(() => {
	mockClients.length = 0;
	mockServers.length = 0;
	mockForwardOut.mockReset();
	silentLogger.log.mockClear();
	silentLogger.error.mockClear();
});

describe('createTunnel', () => {
	it('applies defaults and returns the public shape', async () => {
		const promise = createTunnel(
			{ host: 'example.com' },
			{ srcPort: 9000, dstPort: 3306 },
			{ logger: silentLogger }
		);
		mockClients[0].emit('ready');

		const result = await promise;

		expect(result.servers).toHaveLength(1);
		expect(result.sshConnection).toBe(mockClients[0]);
		expect(typeof result.close).toBe('function');
		expect(mockClients[0].connect).toHaveBeenCalledWith(
			expect.objectContaining({ host: 'example.com', port: 22, username: 'root' })
		);
		expect(mockServers[0].listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 9000 });
	});

	it('forwards using the client remote address', async () => {
		mockForwardOut.mockImplementation((_srcAddr, _srcPort, _dstAddr, _dstPort, cb) => {
			cb(null, new PassThrough());
		});

		const promise = createTunnel(
			{ host: 'example.com' },
			{ srcPort: 9001, dstPort: 3306 },
			{ logger: silentLogger }
		);
		mockClients[0].emit('ready');
		const { servers } = await promise;

		servers[0]!.emit('connection', makeSocket());

		expect(mockForwardOut).toHaveBeenCalledWith(
			'127.0.0.2',
			12345,
			'127.0.0.1',
			3306,
			expect.any(Function)
		);
	});

	it('rejects with a descriptive Error and preserves the cause', async () => {
		const cause = new Error('boom');
		const promise = createTunnel(
			{ host: 'bad.example.com' },
			{ srcPort: 9002, dstPort: 3306 },
			{ logger: silentLogger }
		);
		mockClients[0].emit('error', cause);

		const error = await promise.catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe('用户名或密码错误, 请检查你的配置信息');
		expect((error as Error).cause).toBe(cause);
	});

	it('allows srcPort to be omitted and listens on a free port', async () => {
		const promise = createTunnel(
			{ host: 'example.com' },
			{ dstPort: 3306 },
			{ logger: silentLogger }
		);
		mockClients[0].emit('ready');
		await promise;

		expect(mockServers[0].listen).toHaveBeenCalledWith({ host: '0.0.0.0', port: 0 });
	});
});

describe('SSHError', () => {
	it('exposes its name and code', () => {
		const error = new SSHError('failed', 'E');
		expect(error.name).toBe('SSHError');
		expect(error.code).toBe('E');
	});
});

describe('NodeSSHTunnel', () => {
	it('honours autoClose and uses the client remote address', async () => {
		const tunnel = new NodeSSHTunnel();
		const connectPromise = tunnel.connect({ host: 'example.com' });
		mockClients[0].emit('ready');
		await connectPromise;

		await tunnel.createTunnel(
			{ srcPort: 9100, dstPort: 3306 },
			{ autoClose: true, logger: silentLogger }
		);

		const socket = makeSocket();
		mockServers[0].emit('connection', socket);

		expect(mockForwardOut).toHaveBeenCalledWith(
			'127.0.0.2',
			12345,
			'127.0.0.1',
			3306,
			expect.any(Function)
		);

		socket.emit('close');
		expect(mockServers[0].close).toHaveBeenCalled();

		await tunnel.close();
	});
});
