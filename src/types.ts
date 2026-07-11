/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type ConnectionState =
  | 'idle'
  | 'connecting-signal'
  | 'waiting-for-peer'
  | 'initiating-webrtc'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'room-full';

export interface PeerInfo {
  id: string;
  username: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderUsername: string;
  text: string;
  timestamp: number;
  isLocal: boolean;
  channel: 'webrtc' | 'websocket' | 'system';
}

export interface WebRtcLog {
  id: string;
  timestamp: string;
  type: 'info' | 'success' | 'warn' | 'error' | 'signal';
  message: string;
}

export interface ParsedCandidate {
  id: string;
  origin: 'local' | 'remote';
  ip: string;
  port: number;
  protocol: string;
  type: 'host' | 'srflx' | 'relay' | 'unknown';
  raw: string;
}
