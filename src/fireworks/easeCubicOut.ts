import { Fn, float } from 'three/tsl'

/**
 * 三次缓出曲线。
 *
 * 将归一化时间 t 映射为 (t-1)³+1，开头快、结尾慢，用于升空与爆炸阶段的生长进度。
 */
export const easeCubicOut = /*@__PURE__*/ Fn( ( [ t ]: [ any ] ) => {

	const x = float( t ).sub( 1.0 )
	return x.mul( x ).mul( x ).add( 1.0 )

}, { t: 'float', return: 'float' } )
