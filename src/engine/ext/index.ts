// Registered extensions, in the order they get first look at a message.
// Commitments run before bills so "homi pledge 10" never reads as a bill; the album before travel so photo
// captions never start a trip.
import type { Extension } from './types.js';
import { commit } from './commit.js';
import { bills } from './bills.js';
import { album } from './album.js';
import { travel } from './travel.js';

export const EXTENSIONS: Extension[] = [commit, bills, album, travel];
export type { Extension } from './types.js';
