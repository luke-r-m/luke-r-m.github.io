/* global QUnit */

import { runStdGeometryTests } from '../../utils/qunit-utils';
import { PolyhedronGeometry, PolyhedronBufferGeometry } from '../../../../src/geometries/PolyhedronGeometry';

export default QUnit.module( 'Geometries', () => {

	QUnit.module( 'PolyhedronGeometry', ( hooks ) => {

		var geometries = undefined;
		hooks.beforeEach( function () {

			var vertices = [
				1, 1, 1, 	- 1, - 1, 1, 	- 1, 1, - 1, 	1, - 1, - 1
			];

			var indices = [
				2, 1, 0, 	0, 3, 2,	1, 3, 0,	2, 3, 1
			];

			geometries = [
				new PolyhedronGeometry( vertices, indices ),
				new PolyhedronBufferGeometry( vertices, indices )
			];

		} );

		// INHERITANCE
		QUnit.todo( "Extending", ( assert ) => {

			assert.ok( false, "everything's gonna be alright" );

		} );

		// INSTANCING
		QUnit.todo( "Instancing", ( assert ) => {

			assert.ok( false, "everything's gonna be alright" );

		} );

		// OTHERS
		QUnit.test( 'Standard geometry tests', ( assert ) => {

			runStdGeometryTests( assert, geometries );

		} );

	} );

} );
