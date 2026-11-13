export default {
	testEnvironment: 'node',
	testMatch: ['<rootDir>/__test__/**/*.test.ts'],
	transform: {
		'^.+\\.ts$': [
			'ts-jest',
			{
				// jest 以 CommonJS 方式运行，覆盖 tsconfig.json 的 module: esnext
				// types 需显式声明（内联 tsconfig 不会自动加载 node_modules/@types）
				tsconfig: { module: 'commonjs', esModuleInterop: true, target: 'es2021', strict: true, types: ['jest', 'node'] },
			},
		],
	},
};
