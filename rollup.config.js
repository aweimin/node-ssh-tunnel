import typescript from '@rollup/plugin-typescript';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

// 读取 package.json 和 tsconfig.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const tsconfig = JSON.parse(readFileSync('./tsconfig.json', 'utf-8'));

// 确保你的 package.json 有这些字段
const name = pkg.name;
const input = 'src/index.ts'; // 入口文件路径

// 为 UMD 格式准备的全局变量名称（驼峰命名）
const umdName = name
	.replace(/^@/, '')
	.replace(/[-\/]/g, '_')
	.split('_')
	.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
	.join('');

export default [
	// CommonJS 输出
	{
		input,
		output: {
			file: pkg.main, // 通常是 'dist/index.cjs.js'
			format: 'cjs',
			exports: 'auto',
			sourcemap: false,
		},
		plugins: [
			resolve(),
			commonjs(),
			typescript({
				...tsconfig.compilerOptions,
				declaration: true,
				declarationDir: 'lib',
				rootDir: 'src',
				outDir: 'lib',
			}),
			terser(), // 代码压缩
		],
		external: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})],
	},

	// ES Module 输出
	{
		input,
		output: {
			file: pkg.module, // 通常是 'dist/index.esm.js'
			format: 'esm',
			sourcemap: false,
		},
		plugins: [
			resolve(),
			commonjs(),
			typescript({
				...tsconfig.compilerOptions,
				declaration: true, // 只在 CJS 构建中生成声明文件
				rootDir: 'src',
				outDir: 'es',
			}),
			terser(), // 代码压缩
		],
		external: [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.peerDependencies || {})],
	},

	// UMD 输出 (开发版 - 未压缩)
	// {
	// 	input,
	// 	output: {
	// 		file: pkg.unpkg.replace('.min', ''), // 通常是 'dist/index.umd.js'
	// 		format: 'umd',
	// 		name: umdName, // 全局变量名
	// 		sourcemap: false,
	// 		globals: {}, // 可以在这里指定外部依赖的全局变量名
	// 	},
	// 	plugins: [
	// 		resolve(),
	// 		commonjs(),
	// 		typescript({
	// 			...tsconfig.compilerOptions,
	// 			declaration: false,
	// 			rootDir: 'src',
	// 			outDir: 'dist',
	// 		}),
	// 	],
	// 	external: [...Object.keys(pkg.peerDependencies || {}), 'ssh2'], // UMD 通常打包所有非 peer 依赖
	// },

	// UMD 输出 (生产版 - 压缩)
	{
		input,
		output: {
			file: pkg.unpkg, // 通常是 'dist/index.umd.min.js'
			format: 'umd',
			name: umdName,
			sourcemap: false,
			globals: {},
		},
		plugins: [
			resolve(),
			commonjs(),
			typescript({
				...tsconfig.compilerOptions,
				declaration: false,
				rootDir: 'src',
				outDir: 'dist',
			}),
			terser(), // 代码压缩
		],
		external: [...Object.keys(pkg.peerDependencies || {}), 'ssh2'],
	},
];
