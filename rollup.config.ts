import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const tsconfig = JSON.parse(readFileSync('./tsconfig.json', 'utf-8'));

const input = 'src/index.ts';

const umdName = pkg.name
	.replace(/^@/, '')
	.replaceAll('-', '_')
	.replaceAll('/', '_')
	.split('_')
	.map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
	.join('');

const external = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})];

const commonPlugins = [resolve(), commonjs()];

export default [
	// CommonJS
	{
		input,
		output: {
			file: './lib/index.cjs',
			format: 'cjs',
			exports: 'auto',
			sourcemap: false,
		},
		plugins: [
			...commonPlugins,
			typescript({
				...tsconfig.compilerOptions,
				declaration: false,
				rootDir: 'src',
				outDir: 'lib',
			}),
		],
		external,
	},

	// ES Module + TypeScript declarations
	{
		input,
		output: {
			file: './es/index.js',
			format: 'esm',
			sourcemap: false,
		},
		plugins: [
			...commonPlugins,
			typescript({
				...tsconfig.compilerOptions,
				declaration: true,
				declarationDir: 'es',
				rootDir: 'src',
				outDir: 'es',
			}),
		],
		external,
	},

	// UMD
	{
		input,
		output: {
			file: pkg.unpkg,
			format: 'umd',
			name: umdName,
			sourcemap: false,
			globals: {},
		},
		plugins: [
			...commonPlugins,
			typescript({
				...tsconfig.compilerOptions,
				declaration: false,
				rootDir: 'src',
				outDir: 'dist',
			}),
			terser(),
		],
		external: [...Object.keys(pkg.peerDependencies || {}), 'ssh2'],
	},
];
