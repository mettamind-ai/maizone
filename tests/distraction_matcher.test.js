import assert from 'node:assert/strict';
import test from 'node:test';

import { getDistractionMatch, getHostnameFromUrl, isHostnameInList } from '../distraction_matcher.js';

test('getHostnameFromUrl normalizes hostnames', () => {
  assert.equal(getHostnameFromUrl('https://WWW.FACEBOOK.COM/some/path?x=1'), 'facebook.com');
  assert.equal(getHostnameFromUrl('http://m.facebook.com'), 'm.facebook.com');
  assert.equal(getHostnameFromUrl('chrome://extensions'), '');
});

test('isHostnameInList matches exact and subdomains', () => {
  const sites = ['facebook.com'];
  assert.equal(isHostnameInList('facebook.com', sites), true);
  assert.equal(isHostnameInList('m.facebook.com', sites), true);
  assert.equal(isHostnameInList('notfacebook.com', sites), false);
});

test('getDistractionMatch detects standard distracting sites', () => {
  const state = {
    isEnabled: true,
    blockDistractions: true,
    isInFlow: false,
    distractingSites: ['facebook.com'],
    deepWorkBlockedSites: ['messenger.com']
  };

  const match = getDistractionMatch('https://facebook.com', state);
  assert.equal(match.isDistracting, true);
  assert.equal(match.isDeepWorkBlocked, false);
  assert.equal(match.hostname, 'facebook.com');
});

test('getDistractionMatch detects deep work blocked sites only in flow', () => {
  const baseState = {
    isEnabled: true,
    blockDistractions: true,
    distractingSites: ['facebook.com'],
    deepWorkBlockedSites: ['messenger.com']
  };

  const notInFlow = getDistractionMatch('https://messenger.com', { ...baseState, isInFlow: false });
  assert.equal(notInFlow.isDistracting, false);
  assert.equal(notInFlow.isDeepWorkBlocked, false);

  const inFlow = getDistractionMatch('https://messenger.com', { ...baseState, isInFlow: true });
  assert.equal(inFlow.isDistracting, true);
  assert.equal(inFlow.isDeepWorkBlocked, true);
});

test('getDistractionMatch respects disabled settings', () => {
  const state = {
    isEnabled: false,
    blockDistractions: true,
    isInFlow: true,
    distractingSites: ['facebook.com'],
    deepWorkBlockedSites: ['messenger.com']
  };

  const match = getDistractionMatch('https://facebook.com', state);
  assert.equal(match.isDistracting, false);
});

