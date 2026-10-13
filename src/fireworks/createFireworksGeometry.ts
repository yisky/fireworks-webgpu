import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three/webgpu'

/**
 * 烟花飘带几何的构建参数。
 *
 * 这些量决定网格拓扑与顶点位置，创建后不可通过 uniform 修改。
 */
export type FireworksGeometryOptions = {
	/** 每条爆炸射线的目标长度半径。 */
	radius?: number
	/** Icosahedron sphere subdivision level; directions are unique after sphere projection. */
	detail?: number
	/** 每条射线沿切线的分段数。 */
	segments?: number
	/** 抛物线下坠系数；位置为 dir·s − (0, 0.5·g·s², 0)。 */
	gravity?: number
}

/**
 * Build fireworks ribbon geometry from icosahedron burst directions.
 *
 * 1. Build a regular icosahedron, subdivide faces by `detail`, project to the sphere;
 * 2. Dedup directions with Vector3.equals so each unique ray becomes one trail only;
 * 3. Sample `segments` points along each ray with gravity parabola; each sample is a L/R pair
 *    (uv.x = side, uv.y = normalized arc length, tangent, isBurstTrail=1);
 * 4. Append one launch trail placeholder (isBurstTrail=0), expanded in the vertex shader;
 * 5. Index adjacent L/R samples into quads; the VS billboards via cross(look, tangent).
 */
export function createFireworksGeometry( options: FireworksGeometryOptions = {} ): BufferGeometry {

	const { radius = 1.0, detail = 0, segments = 5, gravity = 1.0 } = options

	const t = ( 1 + Math.sqrt( 5 ) ) / 2

	const vertices = [
		-1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
		0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
		t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
	]

	const faceIndices = [
		0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
		1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
		3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
		4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
	]

	const vertexBuffer: Vector3[] = []

	function getVertexByIndex( index: number, vertex: Vector3 ): void {

		const stride = index * 3
		vertex.set( vertices[ stride ], vertices[ stride + 1 ], vertices[ stride + 2 ] )

	}

	function pushVertex( vertex: Vector3 ): void {

		// Unique directions only: shared icosahedron corners (and subdivided edge points)
		// would otherwise emit many AdditiveBlending ribbons along the same ray.
		if ( vertexBuffer.findIndex( ( v ) => v.equals( vertex ) ) < 0 ) {

			vertexBuffer.push( vertex.clone() )

		}

	}

	function subdivideFace( a: Vector3, b: Vector3, c: Vector3, faceDetail: number ): void {

		const cols = faceDetail + 1
		const v: Vector3[][] = []

		for ( let i = 0; i <= cols; i++ ) {

			v[ i ] = []
			const aj = a.clone().lerp( c, i / cols )
			const bj = b.clone().lerp( c, i / cols )
			const rows = cols - i

			for ( let j = 0; j <= rows; j++ ) {

				if ( j === 0 && i === cols ) {

					v[ i ][ j ] = aj

				} else {

					v[ i ][ j ] = aj.clone().lerp( bj, j / rows )

				}

			}

		}

		for ( let i = 0; i < cols; i++ ) {

			for ( let j = 0; j < 2 * ( cols - i ) - 1; j++ ) {

				const k = Math.floor( j / 2 )

				if ( j % 2 === 0 ) {

					pushVertex( v[ i ][ k + 1 ] )
					pushVertex( v[ i + 1 ][ k ] )
					pushVertex( v[ i ][ k ] )

				} else {

					pushVertex( v[ i ][ k + 1 ] )
					pushVertex( v[ i + 1 ][ k + 1 ] )
					pushVertex( v[ i + 1 ][ k ] )

				}

			}

		}

	}

	function subdivide( faceDetail: number ): void {

		const a = new Vector3()
		const b = new Vector3()
		const c = new Vector3()

		for ( let i = 0; i < faceIndices.length; i += 3 ) {

			getVertexByIndex( faceIndices[ i ], a )
			getVertexByIndex( faceIndices[ i + 1 ], b )
			getVertexByIndex( faceIndices[ i + 2 ], c )
			subdivideFace( a, b, c, faceDetail )

		}

	}

	function buildGeometry( trailRadius: number ): BufferGeometry {

		const positions: number[] = []
		const tangents: number[] = []
		const uvs: number[] = []
		const isBurstTrails: number[] = []
		const indices: number[] = []
		const vertex = new Vector3()
		const temp = new Vector3()
		const prev = new Vector3()
		const tangent = new Vector3()

		for ( let i = 0, il = vertexBuffer.length; i < il; i++ ) {

			tangent.copy( vertexBuffer[ i ] ).normalize()
			vertex.copy( tangent ).multiplyScalar( trailRadius )
			prev.set( 0, 0, 0 )

			const space = vertex.length() / segments

			positions.push( 0, 0, 0, 0, 0, 0 )
			uvs.push( 1, 0, 0, 0 )
			isBurstTrails.push( 1, 1 )

			let accumulatedDistance = 0

			for ( let j = 1; j <= segments; j++ ) {

				vertex
					.copy( tangent )
					.multiplyScalar( j * space )
					.sub( temp.set( 0, 0.5 * gravity * Math.pow( j * space, 2 ), 0 ) )

				positions.push( vertex.x, vertex.y, vertex.z, vertex.x, vertex.y, vertex.z )

				temp.copy( vertex ).sub( prev ).normalize()

				if ( j === 1 ) {

					tangents.push( temp.x, temp.y, temp.z, temp.x, temp.y, temp.z )

				}

				tangents.push( temp.x, temp.y, temp.z, temp.x, temp.y, temp.z )

				accumulatedDistance += vertex.distanceTo( prev )
				uvs.push( 1, accumulatedDistance, 0, accumulatedDistance )
				isBurstTrails.push( 1, 1 )
				prev.copy( vertex )

			}

			for ( let j = 0; j <= segments; j++ ) {

				uvs[ i * ( segments + 1 ) * 4 + j * 4 + 1 ] /= accumulatedDistance
				uvs[ i * ( segments + 1 ) * 4 + j * 4 + 3 ] /= accumulatedDistance

			}

			for ( let j = 0; j < segments; j++ ) {

				const a = i * ( segments + 1 ) * 2 + j * 2
				const b = i * ( segments + 1 ) * 2 + j * 2 + 1
				const c = i * ( segments + 1 ) * 2 + ( j + 1 ) * 2
				const d = i * ( segments + 1 ) * 2 + ( j + 1 ) * 2 + 1
				indices.push( a, b, c, b, d, c )

			}

		}

		const offset = positions.length / 3

		positions.push( 0, 0, 0, 0, 0, 0 )
		tangents.push( 1, 1, 1, 1, 1, 1 )
		uvs.push( 1, 0, 0, 0 )
		isBurstTrails.push( 0, 0 )

		positions.push( 1, 1, 1, 1, 1, 1 )
		tangents.push( 1, 1, 1, 1, 1, 1 )
		uvs.push( 1, 1, 0, 1 )
		isBurstTrails.push( 0, 0 )

		indices.push( offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2 )

		vertexBuffer.length = 0

		const geometry = new BufferGeometry()
		geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) )
		geometry.setAttribute( 'tangent', new Float32BufferAttribute( tangents, 3 ) )
		geometry.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) )
		geometry.setAttribute( 'isBurstTrail', new Float32BufferAttribute( isBurstTrails, 1 ) )
		geometry.setIndex( indices )
		return geometry

	}

	subdivide( detail )
	return buildGeometry( radius )

}
