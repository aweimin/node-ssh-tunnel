(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('net'), require('ssh2')) :
    typeof define === 'function' && define.amd ? define(['exports', 'net', 'ssh2'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.NodeSshTunnel = {}, global.net, global.ssh2));
})(this, (function (exports, net, ssh2) { 'use strict';

    const autoClose = (server, connection) => {
        connection.on('close', () => {
            server.getConnections((error, count) => {
                if (count === 0) {
                    server.close();
                }
            });
        });
    };
    const createLocalServer = async (options) => {
        let serverOptions = Object.assign({}, options);
        if (!serverOptions.port && !serverOptions.host) {
            serverOptions = null;
        }
        return new Promise((resolve, reject) => {
            let server = net.createServer();
            let errorHandler = (error) => {
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
    const createSSHConnection = async (config) => {
        return new Promise((resolve, reject) => {
            let conn = new ssh2.Client();
            conn.on('ready', () => resolve(conn));
            conn.on('error', (error) => {
                reject(error);
            });
            conn.connect(config);
        });
    };
    const reCreateSSHConnection = async (config) => {
        return new Promise(async (resolve, reject) => {
            try {
                console.log('ReCreateSSHConnection');
                const conn = await createSSHConnection(config);
                resolve(conn);
            }
            catch (e) {
                setTimeout(() => {
                    resolve(reCreateSSHConnection(config));
                }, 1000);
            }
        });
    };
    const createTunnel = async (sshOptions, forwardOptions, tunnelOptions) => {
        const sshOptionslocal = Object.assign({ port: 22, username: 'root' }, sshOptions);
        const forwardOptionsArray = Array.isArray(forwardOptions) ? forwardOptions : [forwardOptions];
        const forwardOptionsLocal = forwardOptionsArray.map((item) => {
            return Object.assign({ dstAddr: '127.0.0.1', srcAddr: '0.0.0.0' }, item);
        });
        const tunnelOptionsLocal = Object.assign({ autoClose: false, reconnectOnError: true }, tunnelOptions || {});
        let sshConnection;
        const addListenerSshConnection = (sshConnection_) => {
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
        }
        catch (e) {
            return Promise.reject('用户名或密码错误, 请检查你的配置信息');
        }
        const servers = await Promise.all(forwardOptionsLocal.map(async (item) => {
            const serverOptions = { host: item.srcAddr, port: item.srcPort };
            let server;
            const addListenerServer = (server_) => {
                if (tunnelOptionsLocal.reconnectOnError) {
                    server_.on('error', async () => {
                        server = await createLocalServer(serverOptions);
                        addListenerServer(server);
                    });
                }
                server_.on('connection', onConnectionHandler);
                server_.on('close', () => {
                    // sshConnection.end();
                    console.log('close tunel: ', `${item.srcAddr}:${item.srcPort} => ${sshOptions.host}:${item.dstPort}`);
                });
            };
            console.log('create tunel success: ', `${item.srcAddr}:${item.srcPort} => ${sshOptions.host}:${item.dstPort}`);
            const onConnectionHandler = (clientConnection, num = 0) => {
                if (tunnelOptionsLocal.autoClose) {
                    autoClose(server, clientConnection);
                }
                // if (sshConnection.isBroken) {
                // 	return;
                // }
                if (sshConnection) {
                    try {
                        sshConnection.forwardOut(item.srcAddr, item.srcPort, item.dstAddr, item.dstPort, (err, stream) => {
                            if (err) {
                                // if (server) {
                                // 	server.close();
                                // }
                                // throw err;
                                console.log(err.message);
                                clientConnection.on('close', () => { });
                                clientConnection.on('error', () => { });
                                try {
                                    clientConnection.end();
                                    clientConnection.destroy();
                                }
                                catch (e) {
                                    console.log(e);
                                }
                            }
                            else {
                                clientConnection.on('close', () => {
                                    stream.end();
                                });
                                clientConnection.on('error', () => {
                                    stream.end();
                                });
                                clientConnection.pipe(stream).pipe(clientConnection);
                            }
                        });
                    }
                    catch (e) {
                        clientConnection.on('close', () => { });
                        clientConnection.on('error', () => { });
                        try {
                            clientConnection.end();
                            clientConnection.destroy();
                        }
                        catch (e) {
                            console.log(e);
                        }
                    }
                }
                else if (num < 20) {
                    setTimeout(() => {
                        onConnectionHandler(clientConnection, num + 1);
                    }, 500);
                }
                else {
                    clientConnection.on('close', () => { });
                    clientConnection.on('error', () => { });
                    try {
                        clientConnection.end();
                        clientConnection.destroy();
                    }
                    catch (e) {
                        console.log(e);
                    }
                }
            };
            try {
                server = await createLocalServer(serverOptions);
                addListenerServer(server);
                return server;
            }
            catch (e) {
                console.log(e);
                return undefined;
            }
        }));
        const close = () => {
            servers.forEach((server) => {
                if (server) {
                    try {
                        server.close();
                    }
                    catch (e) {
                        console.log(e);
                    }
                }
            });
            if (sshConnection) {
                try {
                    sshConnection.end();
                    sshConnection.destroy();
                }
                catch (e) {
                    console.log(e);
                }
            }
        };
        return { servers, sshConnection, close };
    };

    exports.createTunnel = createTunnel;
    exports.default = createTunnel;

    Object.defineProperty(exports, '__esModule', { value: true });

}));
