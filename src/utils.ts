/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ParsedCandidate } from './types';

/**
 * Parses a standard WebRTC ICE candidate string to extract details.
 * Format: candidate:<foundation> <component> <protocol> <priority> <connection-address> <port> typ <candidate-type> ...
 */
export function parseCandidate(candidateStr: string, origin: 'local' | 'remote'): ParsedCandidate | null {
  if (!candidateStr) return null;
  try {
    // Remove "candidate:" prefix if present
    let cleanStr = candidateStr;
    if (cleanStr.startsWith('candidate:')) {
      cleanStr = cleanStr.substring(10);
    }
    
    const parts = cleanStr.trim().split(/\s+/);
    if (parts.length < 6) return null;

    const protocol = parts[2]?.toLowerCase() || 'unknown';
    const ip = parts[4] || 'unknown';
    const port = parseInt(parts[5], 10) || 0;

    // Find the candidate type (host, srflx, relay)
    const typIndex = parts.indexOf('typ');
    let type: 'host' | 'srflx' | 'relay' | 'unknown' = 'unknown';
    if (typIndex !== -1 && parts[typIndex + 1]) {
      const t = parts[typIndex + 1].toLowerCase();
      if (t === 'host') type = 'host';
      else if (t === 'srflx') type = 'srflx';
      else if (t === 'relay') type = 'relay';
    }

    // Skip localhost IPv6 / loopbacks if possible, or keep them for display
    return {
      id: `cand-${origin}-${Math.random().toString(36).substring(2, 7)}`,
      origin,
      ip,
      port,
      protocol,
      type,
      raw: candidateStr
    };
  } catch (err) {
    console.error('Error parsing candidate:', err);
    return null;
  }
}

/**
 * Formats bytes to human readable string
 */
export function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}
