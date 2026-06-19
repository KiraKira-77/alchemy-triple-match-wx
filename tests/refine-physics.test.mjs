import assert from 'node:assert/strict';
import test from 'node:test';

import { RefinePhysics } from '../js/refine-physics.js';

test('refine physics tracks temperature control time buckets', () => {
    const physics = new RefinePhysics();

    physics.temp = 60;
    physics.update(0.1);

    physics.temp = 30;
    physics.update(0.1);

    physics.temp = 100;
    physics.update(0.1);

    assert.deepEqual(physics.getStats(), {
        stableTime: 0.1,
        coldTime: 0.1,
        hotTime: 0.1,
        totalTime: 0.3
    });
});
