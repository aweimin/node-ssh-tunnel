export default {
	reject: ['pnpm'],

	target: (name) => {
		const minorUpArr = ['@types/node', 'typescript'];
		if (minorUpArr.includes(name)) {
			//minor（次版本策略）:
			//只升级 minor 和 patch 版本，不升级 major 版本
			//从 x.y.z 只会升级到 x.(y+n).(z+m)，主版本 x 保持不变
			return 'minor';
		}
		//包括 major（主版本）、minor（次版本）和 patch（补丁版本）的所有更新
		//x.y.z全都升级
		return 'latest';
	},
};
