# node-ssh-tunnel

Create local TCP tunnels over SSH — the Node.js equivalent of:

```text
ssh -L [LOCAL_IP:]LOCAL_PORT:DESTINATION:DESTINATION_PORT [USER@]SSH_SERVER
```

Built on top of [ssh2](https://github.com/mscdex/ssh2).

## Installation

```bash
npm install node-ssh-tunnel
# or
pnpm add node-ssh-tunnel
```

## Quick start

```ts
import { createTunnel } from 'node-ssh-tunnel';

const { servers, sshConnection, close } = await createTunnel(
	{
		host: '192.168.8.88',
		port: 22,
		username: 'root',
		password: process.env.SSH_PASSWORD, // avoid hard-coded credentials
	},
	{
		srcAddr: '0.0.0.0',
		srcPort: 9094,
		dstAddr: '127.0.0.1',
		dstPort: 9094,
	},
	{ autoClose: false, reconnectOnError: true }
);

const address = servers[0]?.address();
console.log(`listening on ${address?.address}:${address?.port}`);

sshConnection?.on('error', (error) => console.error(error));

// when you are done
close();
```

`createTunnel` rejects with an `Error` when the SSH connection fails. The original
error is available on `error.cause`, and the message is
`用户名或密码错误, 请检查你的配置信息` for backward compatibility.

## Configuration

### TunnelOptions

| Option             | Type       | Default   | Description                                                                 |
| ------------------ | ---------- | --------- | --------------------------------------------------------------------------- |
| `autoClose`        | `boolean`  | `false`   | Close the local server once all clients disconnect. Useful for short scripts. |
| `reconnectOnError` | `boolean`  | `true`    | Recreate the SSH connection / local server when it breaks.                  |
| `logger`           | `Logger`   | `console` | Custom logger with `log` and `error` methods. Pass a no-op logger to silence output. |

### SshOptions

`SshOptions` is the [`ConnectConfig`](https://github.com/mscdex/ssh2#client-instance) type from `ssh2`.
Defaults: `port: 22`, `username: 'root'`.

```ts
const sshOptions = {
	host: '192.168.8.88',
	port: 22,
	username: 'root',
	privateKey: readFileSync('~/.ssh/id_rsa'),
};
```

For SSH agent forwarding see the [ssh2 documentation](https://www.npmjs.com/package/ssh2#installation):

```ts
// Linux / macOS
const sshOptions = { host: 'myhost.com', agent: process.env.SSH_AUTH_SOCK };
// Windows with Pageant
const sshOptions = { host: 'myhost.com', agent: 'pageant' };
// Windows with an OpenSSH agent pipe (WSL / Docker)
const sshOptions = { host: 'myhost.com', agent: '\\\\.\\pipe\\openssh-ssh-agent' };
```

### ForwardOptions

| Option    | Type     | Default     | Description                                                    |
| --------- | -------- | ----------- | -------------------------------------------------------------- |
| `srcAddr` | `string` | `0.0.0.0`   | Local address / interface to listen on.                        |
| `srcPort` | `number` | OS-chosen   | Local port. Omit it to let the OS pick a free port.             |
| `dstAddr` | `string` | `127.0.0.1` | Remote address to forward traffic to.                          |
| `dstPort` | `number` | —           | Remote port to forward traffic to.                             |

```ts
// Let the OS choose a free local port
const { servers } = await createTunnel(sshOptions, {
	dstAddr: '127.0.0.1',
	dstPort: 9094,
});
console.log(servers[0]?.address());
```

## API

### `createTunnel(sshOptions, forwardOptions, tunnelOptions?)`

Default export and named export. Returns
`Promise<{ servers, sshConnection, close }>`, where `servers` is an array of
Node `net.Server` instances and `sshConnection` is an `ssh2` `Client`.

### `createTunnelEx(sshOptions, forwardOptions, tunnelOptions?)`

Returns a `NodeSSHTunnel` instance instead of the plain object.

### `NodeSSHTunnel`

| Method                          | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `connect(sshOptions)`           | Connect to the SSH server.                     |
| `createTunnel(forward, tunnel)` | Create local forwarding servers.               |
| `getConnection()`               | Return the SSH client, or throw if disconnected. |
| `isConnected()`                 | Whether the SSH client is connected.           |
| `reConnect()`                   | Recreate the SSH connection.                   |
| `disconnect()`                  | Disconnect the SSH client and cancel retries.  |
| `closeTunnel()`                 | Close all local servers.                       |
| `close()`                       | Disconnect and close all tunnels.              |

### `SSHError`

Extends `Error` with a public `code` property and `name === 'SSHError'`.

## Examples

### Multiple ports

```ts
import { createTunnel } from 'node-ssh-tunnel';

const ports = [9095, 9096];
const { servers, close } = await createTunnel(
	sshOptions,
	ports.map((port) => ({
		srcAddr: '127.0.0.1',
		srcPort: port,
		dstAddr: '127.0.0.1',
		dstPort: port,
	})),
	{ autoClose: false, reconnectOnError: true }
);

servers.forEach((server) => {
	server?.on('connection', () => console.log('new connection'));
});
```

### Class API

```ts
import { createTunnelEx } from 'node-ssh-tunnel';

const tunnel = await createTunnelEx(
	sshOptions,
	{ srcPort: 9094, dstAddr: '127.0.0.1', dstPort: 9094 },
	{ autoClose: true }
);

tunnel.getConnection().on('error', (error) => console.error(error));

// later
await tunnel.close();
```

## TypeScript

Types are exported:

```ts
import { createTunnel } from 'node-ssh-tunnel';
import type { ForwardOptions, Logger, SshOptions, TunnelOptions } from 'node-ssh-tunnel';
```

## Changelog

### 2.0.0

- **BREAKING**: `createTunnel` rejects with an `Error` (with `cause`) instead of a string.
- **BREAKING**: `SSHError.name` is now `SSHError`; `code` is publicly readable.
- `ForwardOptions.srcPort` is now optional; the OS picks a free port when omitted.
- Internal implementations of `createTunnel` and `NodeSSHTunnel` are unified; public signatures are unchanged.

### 1.0.11

- Added `close()` method.

### 1.0.0

- Improved TypeScript support.
- `sshOptions.username` defaults to `root`.
- `forwardOptions.dstAddr` defaults to `127.0.0.1`.
- `forwardOptions.srcAddr` defaults to `0.0.0.0`.

## History and credits

This package was originally created to show colleagues how to create and publish an npm package.
SSH tunnels were used daily on Unix machines, so it was rewritten in Node. That was about six
years ago, when JavaScript was callback hell. Since then it has been community-driven through
pull requests and suggestions. Thank you for your support.

Special thanks to:

- Brian White for the fantastic [ssh2](https://github.com/mscdex/ssh2) library this project is based on.
- Vlad Barboni for the initial brainstorming.
- derekrliang for providing the type definitions.
- lenchvolodymyr for the idea of dynamic port mapping.
