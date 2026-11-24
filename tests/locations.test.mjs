import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createLocationLookup, unpricedLocations} from '../site/locations.js';

const locations = [
  {id:'node/1', name:'BP', address:'100 North Main Street', city:'Madison', countyFips:'55025', lat:43.071, lng:-89.405},
  {id:'node/2', name:'Shell', address:'100 North Main Street', city:'Verona', countyFips:'55025', lat:42.990, lng:-89.535},
  {id:'way/3', name:'Kwik Trip', address:'101 S Main St', city:'Madison', countyFips:'55025', lat:43.073, lng:-89.406},
];

test('street matching uses the normalized address and city', () => {
  const match = createLocationLookup(locations);
  assert.equal(match({address:'100 N Main St',city:'MADISON',countyFips:'55025'})?.id, 'node/1');
  assert.equal(match({address:'100 N Main St',city:'',countyFips:'55025'}), null);
});

test('only location pins represented by a priced station are removed', () => {
  const match = createLocationLookup(locations);
  const quotes = [
    {name:'BP',address:'100 N MAIN ST',city:'MADISON',countyFips:'55025',price:3.25},
    {name:'Kwik Trip #121',lat:43.0731,lng:-89.4061,price:3.23},
  ];
  assert.deepEqual(unpricedLocations(locations,quotes,match).map(place=>place.id), ['node/2']);
  assert.equal(unpricedLocations(locations,[],match).length, 3);
});
