/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  MonitorUp,
  Send,
  Terminal,
  Network,
  Globe,
  Users,
  RefreshCw,
  Wifi,
  WifiOff,
  Copy,
  Check,
  Activity,
  Info,
  ExternalLink,
  Lock,
  Zap,
  MessageSquare,
  Shield,
  HelpCircle
} from 'lucide-react';
import { ConnectionState, PeerInfo, ChatMessage, WebRtcLog, ParsedCandidate } from './types';
import { parseCandidate } from './utils';

export default function App() {
  // --- STATE VARIABLES ---
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [clientId, setClientId] = useState('');
  const [peerInfo, setPeerInfo] = useState<PeerInfo | null>(null);
  
  // Tabs for the right panel: 'chat' | 'ips' | 'logs'
  const [activeTab, setActiveTab] = useState<'chat' | 'ips' | 'logs'>('chat');
  
  // Data lists
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<WebRtcLog[]>([]);
  const [parsedCandidates, setParsedCandidates] = useState<ParsedCandidate[]>([]);
  const [serverStats, setServerStats] = useState<{ activeRooms: number; count: number } | null>(null);
  
  // Call controls
  const [inputText, setInputText] = useState('');
  const [wsConnected, setWsConnected] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [micEnabled, setMicEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  
  // Peer statuses (received via toggle-media signaling)
  const [peerCameraEnabled, setPeerCameraEnabled] = useState(true);
  const [peerMicEnabled, setPeerMicEnabled] = useState(true);
  
  // UI States
  const [copiedRoom, setCopiedRoom] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);

  // Streams
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  // --- REFS FOR WEBRTC STATE ---
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // --- LOGGING HELPER ---
  const addLog = useCallback((type: 'info' | 'success' | 'warn' | 'error' | 'signal', message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const newLog: WebRtcLog = {
      id: `log-${Math.random().toString(36).substring(2, 9)}`,
      timestamp,
      type,
      message
    };
    setLogs(prev => [newLog, ...prev]);
  }, []);

  // --- FETCH SIGNAL SERVER STATUS ---
  const fetchServerStats = async () => {
    try {
      setIsRefreshingStats(true);
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setServerStats({
          activeRooms: data.activeRooms,
          count: data.rooms.reduce((acc: number, r: any) => acc + r.count, 0)
        });
      }
    } catch (err) {
      console.error('Error fetching server stats:', err);
    } finally {
      setIsRefreshingStats(false);
    }
  };

  useEffect(() => {
    fetchServerStats();
    const interval = setInterval(fetchServerStats, 8000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll chat list
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle local video element binding
  const localVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  // Handle remote video element binding
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  // Set randomized names & room codes to simplify rapid user onboarding
  useEffect(() => {
    const randomNum = Math.floor(100 + Math.random() * 900);
    setName(`User-${randomNum}`);
    setRoomCode(`room-${Math.floor(1000 + Math.random() * 9000)}`);
  }, []);

  // --- SIGNAL ROUTER (SEND OVER WS) ---
  const sendSignal = useCallback((payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  // --- WEBRTC DISCONNECT ---
  const disconnect = useCallback(() => {
    addLog('info', 'Disconnecting and cleaning up call session.');

    // 1. Notify remote peer that call is ending
    sendSignal({ type: 'call-ended' });

    // 2. Stop camera/mic tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        addLog('info', `Stopped track: ${track.kind}`);
      });
      localStreamRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);

    // 3. Clear PeerConnection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // 4. Clear Data Channel
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    // 5. Close Web Socket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 6. Reset State variables
    setWsConnected(false);
    setClientId('');
    setPeerInfo(null);
    setParsedCandidates([]);
    setMessages([]);
    setLogs([]);
    setConnectionState('idle');
    setIsJoined(false);
    setScreenSharing(false);
    setCameraEnabled(true);
    setMicEnabled(true);
    setPeerCameraEnabled(true);
    setPeerMicEnabled(true);
  }, [addLog, sendSignal]);

  // --- HANDLE PEER DISCONNECT IN-SESSION ---
  const handlePeerDisconnect = useCallback(() => {
    addLog('warn', 'Peer connection terminated by the other user.');
    
    // Close WebRTC Connection, but KEEP the WS signalling server connected!
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    
    setRemoteStream(null);
    setPeerInfo(null);
    // Clear remote discovered IPs, retain local ones
    setParsedCandidates(prev => prev.filter(c => c.origin === 'local'));
    
    setConnectionState('waiting-for-peer');
    addLog('info', 'Reverted to waiting room. Ready for another user to connect.');
  }, [addLog]);

  // --- DATA CHANNEL EVENT LISTENERS ---
  const setupDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;

    dc.onopen = () => {
      addLog('success', 'P2P WebRTC DataChannel successfully established!');
    };

    dc.onclose = () => {
      addLog('info', 'P2P WebRTC DataChannel connection closed.');
    };

    dc.onerror = (err) => {
      addLog('error', `P2P DataChannel error: ${err}`);
    };

    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'chat') {
          setMessages(prev => [...prev, {
            id: data.id,
            senderId: data.senderId,
            senderUsername: data.senderUsername,
            text: data.text,
            timestamp: data.timestamp,
            isLocal: false,
            channel: 'webrtc'
          }]);
        }
      } catch (err) {
        console.error('Failed to parse incoming DataChannel message:', err);
      }
    };
  }, [addLog]);

  // --- INITIALIZE WEBRTC HANDSHAKE ---
  const startWebRtc = useCallback(async (isInitiator: boolean, targetPeer: PeerInfo) => {
    addLog('info', `Initializing PeerConnection (${isInitiator ? 'Initiating' : 'Receiving'})...`);
    
    // 1. Get Camera/Microphone stream
    let stream: MediaStream | null = null;
    try {
      addLog('info', 'Requesting camera and microphone permissions...');
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      addLog('success', 'Media devices (camera & microphone) accessed successfully.');
    } catch (err: any) {
      addLog('warn', `Media capture failed: ${err.message}. Retrying audio-only...`);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        addLog('success', 'Microphone accessed successfully (audio-only mode).');
      } catch (err2: any) {
        addLog('error', `Permissions denied or no media devices found. Operating in text-only mode.`);
      }
    }

    setLocalStream(stream);
    localStreamRef.current = stream;

    // 2. Create the RTCPeerConnection (use Google STUN servers)
    const configuration: RTCConfiguration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
    
    const pc = new RTCPeerConnection(configuration);
    pcRef.current = pc;

    // 3. Bind media tracks to peer connection
    if (stream) {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream!);
        addLog('info', `Local ${track.kind} track bound to P2P connection.`);
      });
    }

    // 4. Handle remote stream track discovery
    pc.ontrack = (event) => {
      addLog('success', 'Received remote audio/video track from peer.');
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    // 5. Gather and parse ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // Broadcast candidate details to signaling server
        sendSignal({
          type: 'candidate',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex
        });

        // Parse and log the local candidate IP
        const parsed = parseCandidate(event.candidate.candidate, 'local');
        if (parsed) {
          addLog('info', `Generated local candidate: Type [${parsed.type.toUpperCase()}] IP [${parsed.ip}:${parsed.port}]`);
          setParsedCandidates(prev => {
            // Check for duplicates
            if (prev.some(c => c.ip === parsed.ip && c.port === parsed.port && c.origin === 'local')) return prev;
            return [...prev, parsed];
          });
        }
      }
    };

    // 6. Handle ice connection state updates
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      addLog('info', `WebRTC Connection State: ${state}`);
      if (state === 'connected') {
        setConnectionState('connected');
        addLog('success', 'Direct Peer-to-Peer connection established securely!');
      } else if (state === 'failed') {
        setConnectionState('failed');
        addLog('error', 'P2P path failed. Firewalls or symmetric NATs may be blocking WebRTC. Fallback WS chat remains online.');
      } else if (state === 'disconnected') {
        addLog('warn', 'WebRTC connection disconnected.');
      }
    };

    // 7. Setup P2P Data Channels for Chat
    if (isInitiator) {
      addLog('info', 'Creating P2P Data Channel for chat...');
      const dc = pc.createDataChannel('chat-channel');
      setupDataChannel(dc);
    } else {
      pc.ondatachannel = (event) => {
        addLog('success', 'Peer initiated Data Channel successfully.');
        setupDataChannel(event.channel);
      };
    }

    // 8. SDP Offer/Answer negotiation loop
    if (isInitiator) {
      try {
        addLog('info', 'Generating local SDP Offer...');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        
        sendSignal({
          type: 'offer',
          sdp: offer
        });
        addLog('signal', 'SDP Offer broadcasted to room.');
      } catch (err: any) {
        addLog('error', `Failed to create SDP Offer: ${err.message}`);
      }
    }
  }, [addLog, sendSignal, setupDataChannel]);

  // --- NEGOTIATION HANDLERS ---
  const handleOffer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      addLog('info', 'Applying remote SDP Offer...');
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      addLog('success', 'Remote Offer SDP applied successfully.');

      addLog('info', 'Generating local SDP Answer...');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignal({
        type: 'answer',
        sdp: answer
      });
      addLog('signal', 'SDP Answer broadcasted to room.');
    } catch (err: any) {
      addLog('error', `Negotiation failed during Offer application: ${err.message}`);
    }
  }, [addLog, sendSignal]);

  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      addLog('info', 'Applying remote SDP Answer...');
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      addLog('success', 'Negotiation handshake completed. Direct P2P negotiation finished.');
    } catch (err: any) {
      addLog('error', `Negotiation failed during Answer application: ${err.message}`);
    }
  }, [addLog]);

  const handleRemoteCandidate = useCallback(async (candidate: string, sdpMid: string | null, sdpMLineIndex: number | null) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate({
        candidate,
        sdpMid: sdpMid ?? undefined,
        sdpMLineIndex: sdpMLineIndex ?? undefined
      }));

      // Parse and register remote candidate IP details
      const parsed = parseCandidate(candidate, 'remote');
      if (parsed) {
        addLog('info', `Added remote candidate: Type [${parsed.type.toUpperCase()}] IP [${parsed.ip}:${parsed.port}]`);
        setParsedCandidates(prev => {
          if (prev.some(c => c.ip === parsed.ip && c.port === parsed.port && c.origin === 'remote')) return prev;
          return [...prev, parsed];
        });
      }
    } catch (err: any) {
      console.warn('Failed to apply ICE candidate:', err);
    }
  }, [addLog]);

  // --- CONNECT TO WS SIGNALLING SERVER ---
  const connect = async () => {
    const trimmedName = name.trim();
    const trimmedRoom = roomCode.trim().toLowerCase();

    if (!trimmedName || !trimmedRoom) {
      alert('Please fill out both your username and a room code!');
      return;
    }

    setIsJoined(true);
    setConnectionState('connecting-signal');
    addLog('info', 'Connecting to real-time signalling server...');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        addLog('success', 'Signalling socket handshake complete. Joining room...');
        ws.send(JSON.stringify({
          type: 'join',
          room: trimmedRoom,
          username: trimmedName
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'joined':
              setClientId(data.clientId);
              addLog('success', `Joined room "${data.room}" as "${trimmedName}" (My ID: ${data.clientId}).`);
              
              if (data.peers && data.peers.length > 0) {
                const existingPeer = data.peers[0];
                setPeerInfo(existingPeer);
                setConnectionState('initiating-webrtc');
                addLog('info', `Found peer "${existingPeer.username}" (ID: ${existingPeer.id}) already in room. Handshaking...`);
                // We are the joiner, we wait for their offer. But we set up peer connection locally.
                await startWebRtc(false, existingPeer);
              } else {
                setConnectionState('waiting-for-peer');
                addLog('info', 'You are the first participant. Waiting for another user to connect...');
              }
              break;

            case 'peer-joined':
              setPeerInfo(data.peer);
              setConnectionState('initiating-webrtc');
              addLog('info', `User "${data.peer.username}" (ID: ${data.peer.id}) entered the room. Creating P2P Offer...`);
              // We were already here, so WE initiate the offer
              await startWebRtc(true, data.peer);
              break;

            case 'offer':
              await handleOffer(data.sdp);
              break;

            case 'answer':
              await handleAnswer(data.sdp);
              break;

            case 'candidate':
              await handleRemoteCandidate(data.candidate, data.sdpMid, data.sdpMLineIndex);
              break;

            case 'peer-left':
              handlePeerDisconnect();
              break;

            case 'room-full':
              setConnectionState('room-full');
              addLog('error', `Failed to join. Room "${data.room}" is currently occupied (Max 2 users).`);
              ws.close();
              break;

            case 'chat-fallback':
              setMessages(prev => [...prev, {
                id: `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                senderId: data.senderId,
                senderUsername: data.senderUsername,
                text: data.text,
                timestamp: data.timestamp,
                isLocal: false,
                channel: 'websocket'
              }]);
              break;

            case 'toggle-media':
              if (data.mediaType === 'video') {
                setPeerCameraEnabled(data.enabled);
              } else if (data.mediaType === 'audio') {
                setPeerMicEnabled(data.enabled);
              }
              break;

            case 'call-ended':
              addLog('info', 'Peer closed the session.');
              handlePeerDisconnect();
              break;

            case 'error':
              addLog('error', `Server error message: ${data.message}`);
              break;
          }
        } catch (err: any) {
          console.error('[WS Message Error]', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        addLog('warn', 'Signalling socket closed.');
      };

      ws.onerror = (err) => {
        addLog('error', 'Signalling socket experienced an error.');
        console.error('[WS Socket Error]', err);
      };

    } catch (err: any) {
      addLog('error', `WebSocket connection failed: ${err.message}`);
      setConnectionState('failed');
    }
  };

  // --- SEND CHAT MESSAGE ---
  const handleSendMessage = (e?: FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text) return;

    const timestamp = Date.now();
    const msgId = `msg-${timestamp}-${Math.random().toString(36).substring(2, 6)}`;

    // Try WebRTC Data Channel first (No server load, direct peer-to-peer!)
    if (dcRef.current && dcRef.current.readyState === 'open') {
      try {
        dcRef.current.send(JSON.stringify({
          type: 'chat',
          id: msgId,
          senderId: clientId,
          senderUsername: name,
          text,
          timestamp
        }));

        setMessages(prev => [...prev, {
          id: msgId,
          senderId: clientId,
          senderUsername: name,
          text,
          timestamp,
          isLocal: true,
          channel: 'webrtc'
        }]);
        setInputText('');
        return;
      } catch (err) {
        console.warn('Failed to send through WebRTC data channel, falling back to WS:', err);
      }
    }

    // Fallback to Signalling WebSocket if WebRTC Data Channel is not established
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-fallback',
        text,
        timestamp
      }));

      setMessages(prev => [...prev, {
        id: msgId,
        senderId: clientId,
        senderUsername: name,
        text,
        timestamp,
        isLocal: true,
        channel: 'websocket'
      }]);
      setInputText('');
    } else {
      addLog('error', 'Unable to send message: No active transport channel.');
    }
  };

  // --- MEDIA TOGGLES ---
  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setCameraEnabled(videoTrack.enabled);
        addLog('info', `Your camera is now ${videoTrack.enabled ? 'ON' : 'OFF'}.`);
        
        // Signal the change to the peer so they can render a placeholder
        sendSignal({
          type: 'toggle-media',
          mediaType: 'video',
          enabled: videoTrack.enabled
        });
      }
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setMicEnabled(audioTrack.enabled);
        addLog('info', `Your microphone is now ${audioTrack.enabled ? 'UNMUTED' : 'MUTED'}.`);

        sendSignal({
          type: 'toggle-media',
          mediaType: 'audio',
          enabled: audioTrack.enabled
        });
      }
    }
  };

  const toggleScreenShare = async () => {
    if (screenSharing) {
      // Restore camera stream
      if (localStreamRef.current) {
        // Stop current screen track
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.stop();
        }

        try {
          addLog('info', 'Re-acquiring camera video track...');
          const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const camTrack = camStream.getVideoTracks()[0];

          // Swap track inside RTCPeerConnection
          if (pcRef.current) {
            const senders = pcRef.current.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
              await videoSender.replaceTrack(camTrack);
            }
          }

          // Swap track inside local stream state
          const tracks = localStreamRef.current.getTracks();
          const oldVideoTrack = tracks.find(t => t.kind === 'video');
          if (oldVideoTrack) {
            localStreamRef.current.removeTrack(oldVideoTrack);
          }
          localStreamRef.current.addTrack(camTrack);

          // Force state update to re-bind ref
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
          setScreenSharing(false);
          setCameraEnabled(true);
          addLog('success', 'Screen sharing terminated. Local camera restored.');
        } catch (err: any) {
          addLog('error', `Failed to restore camera: ${err.message}`);
        }
      }
    } else {
      // Start screen share
      try {
        addLog('info', 'Initiating screen share capture...');
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = displayStream.getVideoTracks()[0];

        // Replace track inside RTCPeerConnection
        if (pcRef.current) {
          const senders = pcRef.current.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            await videoSender.replaceTrack(screenTrack);
          }
        }

        // Handle remote stopping of screen share via native browser button
        screenTrack.onended = () => {
          toggleScreenShare();
        };

        // Replace track inside local stream state
        if (localStreamRef.current) {
          const tracks = localStreamRef.current.getTracks();
          const oldVideoTrack = tracks.find(t => t.kind === 'video');
          if (oldVideoTrack) {
            localStreamRef.current.removeTrack(oldVideoTrack);
          }
          localStreamRef.current.addTrack(screenTrack);
        }

        // Force state update
        setLocalStream(new MediaStream(localStreamRef.current!.getTracks()));
        setScreenSharing(true);
        addLog('success', 'Screen sharing session initiated.');
      } catch (err: any) {
        addLog('error', `Failed to start screen share: ${err.message}`);
      }
    }
  };

  const copyRoomLink = () => {
    navigator.clipboard.writeText(roomCode);
    setCopiedRoom(true);
    setTimeout(() => setCopiedRoom(false), 2000);
  };

  // Classify and filter candidates to identify detected IPs
  const hostLocalIPs = parsedCandidates.filter(c => c.origin === 'local' && c.type === 'host');
  const stunLocalIPs = parsedCandidates.filter(c => c.origin === 'local' && c.type === 'srflx');
  const hostRemoteIPs = parsedCandidates.filter(c => c.origin === 'remote' && c.type === 'host');
  const stunRemoteIPs = parsedCandidates.filter(c => c.origin === 'remote' && c.type === 'srflx');

  // --- RENDERING VIEWS ---
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-teal-500 selection:text-slate-900" id="app_root">
      {/* HEADER BAR */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-50 shrink-0" id="app_header">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-teal-500 to-indigo-500 p-2.5 rounded-xl text-slate-900 shadow-lg shadow-teal-500/10">
            <Zap className="h-6 w-6 font-bold" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-teal-400 via-emerald-300 to-indigo-300 bg-clip-text text-transparent">
              IP Caller
            </h1>
            <p className="text-xs text-slate-400 font-medium font-mono">
              Serverless P2P WebRTC connection console
            </p>
          </div>
        </div>

        {/* SERVER STATISTICS & STATUS BADGE */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-5 border border-slate-800 bg-slate-950/80 px-4 py-1.5 rounded-xl">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-teal-400" />
              <span className="text-xs text-slate-400 font-medium">
                Active connections:{' '}
                <strong className="text-slate-200 font-mono font-bold">
                  {serverStats ? serverStats.count : '...'}
                </strong>
              </span>
            </div>
            <div className="h-3 w-px bg-slate-800" />
            <div className="flex items-center gap-2">
              <Globe className="h-3.5 w-3.5 text-indigo-400" />
              <span className="text-xs text-slate-400 font-medium">
                Rooms online:{' '}
                <strong className="text-slate-200 font-mono font-bold">
                  {serverStats ? serverStats.activeRooms : '...'}
                </strong>
              </span>
            </div>
            <button
              onClick={fetchServerStats}
              disabled={isRefreshingStats}
              className={`text-slate-500 hover:text-slate-300 transition-colors ${
                isRefreshingStats ? 'animate-spin text-teal-400' : ''
              }`}
              title="Refresh Stats"
              id="refresh_stats_btn"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border bg-slate-900 text-xs font-mono border-slate-800">
            {wsConnected ? (
              <>
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span className="text-emerald-400 font-semibold uppercase">Server Connected</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-red-500 inline-block"></span>
                <span className="text-slate-400 font-semibold uppercase">Disconnected</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* MAIN VIEW CONTENT */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 flex flex-col overflow-hidden" id="main_content">
        {!isJoined ? (
          /* JOIN PANEL SCREEN */
          <div className="flex-1 flex flex-col justify-center items-center py-6" id="welcome_screen">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
              <div className="absolute -top-24 -right-24 h-48 w-48 bg-teal-500/10 blur-[80px] rounded-full pointer-events-none" />
              <div className="absolute -bottom-24 -left-24 h-48 w-48 bg-indigo-500/10 blur-[80px] rounded-full pointer-events-none" />
              
              <div className="text-center mb-8">
                <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-teal-500/20 to-indigo-500/20 text-teal-400 flex items-center justify-center rounded-2xl mb-4 border border-teal-500/20 shadow-inner">
                  <Network className="h-7 w-7" />
                </div>
                <h2 className="text-2xl font-extrabold text-slate-100 tracking-tight">
                  Join Calling Room
                </h2>
                <p className="text-slate-400 text-sm mt-2 max-w-xs mx-auto">
                  Provide a username and enter a room code to instantiate a direct peer-to-peer connection with another peer.
                </p>
              </div>

              {/* WELCOME / SETUP FORM */}
              <form onSubmit={(e) => { e.preventDefault(); connect(); }} className="space-y-5" id="join_form">
                <div className="space-y-2">
                  <label htmlFor="username" className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider block">
                    Your Username
                  </label>
                  <input
                    id="username"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-teal-500 transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="room_code" className="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider block">
                    Room Code (Join same code to connect)
                  </label>
                  <input
                    id="room_code"
                    type="text"
                    required
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value)}
                    placeholder="Enter alphanumeric code"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all font-mono"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-gradient-to-r from-teal-500 to-indigo-500 hover:from-teal-400 hover:to-indigo-400 text-slate-950 font-bold px-6 py-3.5 rounded-xl shadow-lg hover:shadow-teal-500/10 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-base cursor-pointer"
                  id="connect_room_btn"
                >
                  <Phone className="h-5 w-5 font-bold text-slate-950" />
                  Connect Session
                </button>
              </form>

              {/* DETAILS / INFOGRAPHIC */}
              <div className="mt-8 border-t border-slate-800/80 pt-6 space-y-3">
                <div className="flex items-start gap-3 text-xs text-slate-400">
                  <Shield className="h-4 w-4 text-teal-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">No Database</strong>: Signal handshakes are distributed through transient socket frames and do not store logs, metadata, or IPs permanently.
                  </span>
                </div>
                <div className="flex items-start gap-3 text-xs text-slate-400">
                  <Lock className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-slate-200">True P2P WebRTC</strong>: Video streams, microphone audio, and chat content flow directly between your machine and your peer's machine without middleman hops.
                  </span>
                </div>
              </div>
            </div>

            {/* SERVER STATUS CARDS ON HOME */}
            <div className="mt-12 w-full max-w-lg grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-slate-800/80 bg-slate-900/40 backdrop-blur rounded-2xl p-5 text-center">
                <Globe className="h-5 w-5 text-indigo-400 mx-auto mb-2" />
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">Public STUN Gateway</h4>
                <p className="text-sm text-slate-200 mt-1">Google STUN Ready</p>
                <p className="text-[10px] text-slate-500 mt-1">stun.l.google.com:19302</p>
              </div>
              <div className="border border-slate-800/80 bg-slate-900/40 backdrop-blur rounded-2xl p-5 text-center">
                <Activity className="h-5 w-5 text-teal-400 mx-auto mb-2" />
                <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">P2P ICE Engine</h4>
                <p className="text-sm text-slate-200 mt-1">Symmetric-NAT Bypass</p>
                <p className="text-[10px] text-slate-500 mt-1">Automatic UDP / TCP Fallback</p>
              </div>
            </div>
          </div>
        ) : (
          /* ACTIVE SESSION VIEW */
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0 overflow-hidden" id="active_session_view">
            
            {/* LEFT COLUMN: ACTIVE CHANNELS & VIDEO VIEWPORT (7/12 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-4 min-h-0">
              
              {/* STREAMS VIEWPORT CONTAINER */}
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl relative overflow-hidden flex items-center justify-center min-h-[300px]" id="streams_container">
                {/* REMOTE VIDEO FRAME */}
                <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-slate-950">
                  {remoteStream && peerCameraEnabled ? (
                    <video
                      id="remote_video"
                      ref={remoteVideoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    /* PLACEHOLDER IF REMOTE CAM UNAVAILABLE */
                    <div className="flex flex-col items-center justify-center text-center p-6 space-y-4">
                      <div className="w-20 h-20 bg-indigo-500/10 text-indigo-400 flex items-center justify-center rounded-full border border-indigo-500/20 animate-pulse">
                        <Users className="h-10 w-10" />
                      </div>
                      <div>
                        <h4 className="text-slate-200 font-bold text-lg">
                          {peerInfo ? peerInfo.username : 'Waiting for Peer...'}
                        </h4>
                        <p className="text-xs text-slate-400 mt-1 max-w-xs font-mono bg-slate-900 px-3 py-1 rounded-full border border-slate-800 inline-block">
                          {connectionState === 'waiting-for-peer'
                            ? 'Share Room Code to let them connect'
                            : !peerCameraEnabled
                            ? 'Camera is disabled'
                            : 'Establishing secure link...'}
                        </p>
                      </div>

                      {connectionState === 'waiting-for-peer' && (
                        <div className="bg-slate-900 p-4 rounded-2xl border border-slate-800 max-w-sm mt-2 space-y-3">
                          <div className="text-xs text-slate-400 font-mono">ROOM CODE</div>
                          <div className="flex items-center gap-2 justify-between bg-slate-950 px-4 py-2 rounded-xl border border-slate-800">
                            <span className="text-teal-400 font-mono font-bold tracking-widest uppercase">{roomCode}</span>
                            <button
                              onClick={copyRoomLink}
                              className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
                              title="Copy Room Code"
                              id="copy_room_btn"
                            >
                              {copiedRoom ? <Check className="h-4 w-4 text-teal-400" /> : <Copy className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* OVERLAYS ON REMOTE VIDEO */}
                {/* 1. ROOM BADGE & P2P STATUS */}
                <div className="absolute top-4 left-4 z-20 flex flex-wrap gap-2 items-center">
                  <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 px-3.5 py-1.5 rounded-full text-xs font-mono flex items-center gap-2">
                    <span className="text-slate-400">Room:</span>
                    <strong className="text-teal-400 font-extrabold tracking-wider uppercase">{roomCode}</strong>
                  </div>
                  
                  {/* CONNECTION STATUS BADGE */}
                  <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800 px-3.5 py-1.5 rounded-full text-xs font-mono flex items-center gap-2">
                    <span className="text-slate-400">P2P:</span>
                    <span className={`font-bold uppercase ${
                      connectionState === 'connected' ? 'text-emerald-400' :
                      connectionState === 'connecting-signal' || connectionState === 'initiating-webrtc' ? 'text-indigo-400 animate-pulse' :
                      connectionState === 'waiting-for-peer' ? 'text-amber-400 animate-pulse' : 'text-red-400'
                    }`}>
                      {connectionState.replace('-', ' ')}
                    </span>
                  </div>
                </div>

                {/* 2. LOCAL PICTURE-IN-PICTURE CAM STREAM */}
                <div className="absolute bottom-4 right-4 z-20 w-32 h-44 sm:w-40 sm:h-52 bg-slate-950 border-2 border-slate-800 rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 group hover:scale-[1.04] hover:border-teal-500">
                  {localStream && cameraEnabled ? (
                    <video
                      id="local_video"
                      ref={localVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-full object-cover transform -scale-x-100"
                    />
                  ) : (
                    <div className="w-full h-full bg-slate-900/90 flex flex-col items-center justify-center text-center p-3">
                      <VideoOff className="h-5 w-5 text-slate-500" />
                      <span className="text-[10px] text-slate-400 font-mono mt-1 font-semibold">Self Video Off</span>
                    </div>
                  )}
                  {/* Local Stream Label */}
                  <div className="absolute bottom-1.5 left-1.5 bg-slate-950/70 backdrop-blur-md border border-slate-800 px-1.5 py-0.5 rounded-md text-[9px] font-mono text-slate-300 font-medium">
                    Self {micEnabled ? '' : '(Muted)'}
                  </div>
                </div>

                {/* 3. PEER BANNER IF ONLINE */}
                {peerInfo && (
                  <div className="absolute bottom-4 left-4 z-20 bg-slate-950/80 backdrop-blur-md border border-slate-800 px-4 py-2.5 rounded-2xl max-w-xs flex flex-col">
                    <span className="text-[9px] font-mono uppercase tracking-wider text-slate-400 font-bold">Remote Peer</span>
                    <span className="text-sm text-slate-100 font-bold flex items-center gap-2">
                      {peerInfo.username}
                      <span className={`h-1.5 w-1.5 rounded-full ${peerMicEnabled ? 'bg-teal-400' : 'bg-rose-500 animate-ping'}`} title={peerMicEnabled ? 'Microphone active' : 'Microphone muted'} />
                    </span>
                    
                    {/* Extra parsed IP details on display overlay */}
                    {stunRemoteIPs.length > 0 && (
                      <span className="text-[10px] font-mono text-indigo-400 mt-1 font-semibold">
                        IP: {stunRemoteIPs[0].ip}:{stunRemoteIPs[0].port} (Reflexive)
                      </span>
                    )}
                    {stunRemoteIPs.length === 0 && hostRemoteIPs.length > 0 && (
                      <span className="text-[10px] font-mono text-emerald-400 mt-1 font-semibold">
                        IP: {hostRemoteIPs[0].ip}:{hostRemoteIPs[0].port} (Local)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* VIDEO CONTROLS BAR */}
              <div className="bg-slate-900 border border-slate-800 p-4 rounded-3xl flex flex-wrap items-center justify-between gap-4" id="controls_bar">
                <div className="flex items-center gap-2">
                  {/* MIC TOGGLE */}
                  <button
                    onClick={toggleMic}
                    disabled={!localStream}
                    className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                      !localStream ? 'opacity-40 border-slate-800 bg-slate-950 text-slate-600' :
                      micEnabled
                        ? 'bg-slate-950 border-slate-800 text-teal-400 hover:text-teal-300 hover:border-slate-700'
                        : 'bg-rose-950/50 border-rose-900/60 text-rose-400 hover:bg-rose-950 hover:text-rose-300'
                    }`}
                    title={micEnabled ? 'Mute Microphone' : 'Unmute Microphone'}
                    id="toggle_mic_btn"
                  >
                    {micEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                  </button>

                  {/* CAMERA TOGGLE */}
                  <button
                    onClick={toggleCamera}
                    disabled={!localStream}
                    className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                      !localStream ? 'opacity-40 border-slate-800 bg-slate-950 text-slate-600' :
                      cameraEnabled
                        ? 'bg-slate-950 border-slate-800 text-teal-400 hover:text-teal-300 hover:border-slate-700'
                        : 'bg-rose-950/50 border-rose-900/60 text-rose-400 hover:bg-rose-950 hover:text-rose-300'
                    }`}
                    title={cameraEnabled ? 'Disable Camera' : 'Enable Camera'}
                    id="toggle_camera_btn"
                  >
                    {cameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                  </button>

                  {/* SCREEN SHARE */}
                  <button
                    onClick={toggleScreenShare}
                    disabled={!localStream}
                    className={`p-3.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                      !localStream ? 'opacity-40 border-slate-800 bg-slate-950 text-slate-600' :
                      screenSharing
                        ? 'bg-indigo-950/50 border-indigo-900/60 text-indigo-400 hover:bg-indigo-950'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                    title={screenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
                    id="toggle_screenshare_btn"
                  >
                    <MonitorUp className="h-5 w-5" />
                  </button>
                </div>

                {/* END SESSION DISCONNECT */}
                <button
                  onClick={disconnect}
                  className="bg-rose-600 hover:bg-rose-500 hover:shadow-rose-600/15 text-white font-bold font-sans px-6 py-3.5 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer border border-rose-500/30"
                  id="disconnect_btn"
                >
                  <PhoneOff className="h-5 w-5" />
                  End Calling Session
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: CHAT / IP TRACKER / LOG TABS (5/12 cols) */}
            <div className="lg:col-span-5 flex flex-col bg-slate-900 border border-slate-800 rounded-3xl min-h-0 overflow-hidden" id="tab_panel">
              
              {/* TAB BUTTONS BAR */}
              <div className="border-b border-slate-800 bg-slate-950/40 p-2 flex gap-1.5" id="tab_buttons">
                <button
                  onClick={() => setActiveTab('chat')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-mono font-bold uppercase transition-all tracking-wider cursor-pointer ${
                    activeTab === 'chat'
                      ? 'bg-slate-800 text-teal-400 shadow-md border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                  id="tab_chat_btn"
                >
                  <MessageSquare className="h-4 w-4" />
                  P2P Chat
                </button>
                
                <button
                  onClick={() => setActiveTab('ips')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-mono font-bold uppercase transition-all tracking-wider cursor-pointer ${
                    activeTab === 'ips'
                      ? 'bg-slate-800 text-teal-400 shadow-md border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                  id="tab_ips_btn"
                >
                  <Network className="h-4 w-4" />
                  IP Tracker
                </button>

                <button
                  onClick={() => setActiveTab('logs')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-mono font-bold uppercase transition-all tracking-wider cursor-pointer ${
                    activeTab === 'logs'
                      ? 'bg-slate-800 text-teal-400 shadow-md border-slate-700'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                  }`}
                  id="tab_logs_btn"
                >
                  <Terminal className="h-4 w-4" />
                  Signal Log
                </button>
              </div>

              {/* TAB CONTENT SPACE */}
              <div className="flex-1 flex flex-col min-h-0 p-4" id="tab_content_space">
                
                {/* --- TAB 1: P2P CHAT PANEL --- */}
                {activeTab === 'chat' && (
                  <div className="flex-1 flex flex-col min-h-0" id="chat_panel">
                    {/* Message Box */}
                    <div className="flex-1 overflow-y-auto pr-1 mb-4 space-y-3.5 scrollbar-thin scrollbar-thumb-slate-800" id="message_box">
                      {messages.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
                          <MessageSquare className="h-10 w-10 text-slate-700 mb-2" />
                          <span className="text-sm font-semibold text-slate-400">No chat messages yet</span>
                          <p className="text-xs text-slate-500 mt-1 max-w-xs">
                            Send direct, serverless messages. They will be distributed using WebRTC or WebSocket fallback depending on status.
                          </p>
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex flex-col max-w-[85%] ${
                              msg.isLocal ? 'ml-auto items-end' : 'mr-auto items-start'
                            }`}
                          >
                            <div className="flex items-baseline gap-2 mb-1">
                              <span className="text-xs font-bold text-slate-300">
                                {msg.isLocal ? 'You' : msg.senderUsername}
                              </span>
                              <span className="text-[9px] font-mono text-slate-500">
                                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>

                            <div
                              className={`px-4 py-2.5 rounded-2xl text-sm relative ${
                                msg.isLocal
                                  ? 'bg-teal-500 text-slate-950 font-medium rounded-tr-none'
                                  : 'bg-slate-800 text-slate-100 rounded-tl-none'
                              }`}
                            >
                              <p className="break-all whitespace-pre-wrap">{msg.text}</p>
                            </div>

                            {/* Signal delivery channel tag */}
                            <span className={`text-[8px] font-mono mt-1 ${
                              msg.channel === 'webrtc' ? 'text-emerald-400' : 'text-purple-400'
                            }`}>
                              via {msg.channel === 'webrtc' ? 'P2P DataChannel' : 'Signalling WebSockets'}
                            </span>
                          </div>
                        ))
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Input bar */}
                    <form onSubmit={handleSendMessage} className="flex gap-2 shrink-0" id="chat_input_form">
                      <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        placeholder="Type serverless message..."
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-teal-500 placeholder-slate-600 text-slate-100"
                        id="chat_input"
                      />
                      <button
                        type="submit"
                        disabled={!inputText.trim()}
                        className="bg-teal-500 hover:bg-teal-400 disabled:opacity-40 disabled:hover:bg-teal-500 text-slate-950 font-bold px-4 rounded-xl transition-all cursor-pointer"
                        id="chat_send_btn"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                )}

                {/* --- TAB 2: IP TRACKER & CANDIDATE ANALYZER --- */}
                {activeTab === 'ips' && (
                  <div className="flex-1 overflow-y-auto pr-1 space-y-5 scrollbar-thin scrollbar-thumb-slate-800" id="ips_panel">
                    
                    {/* MAIN EXPLANATION HEADER */}
                    <div className="bg-indigo-950/20 border border-indigo-900/30 p-4 rounded-2xl text-xs space-y-2 text-indigo-200">
                      <div className="flex items-center gap-2 font-bold font-mono text-[10px] tracking-wider uppercase text-indigo-400">
                        <Info className="h-4 w-4" />
                        How does IP Tracking work?
                      </div>
                      <p>
                        During a WebRTC handshake, browsers generate Interactive Connectivity Establishment (ICE) candidates to discover possible routes.
                        By reading candidate SDP descriptors, we can extract the local networks and public internet gateways.
                      </p>
                    </div>

                    {/* PARSED NETWORK INTERFACES GRID */}
                    <div className="space-y-4">
                      {/* 1. PUBLIC INTERNET GATEWAYS */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Globe className="h-3.5 w-3.5 text-indigo-400" />
                          Public Gateways (Via STUN Discovery)
                        </h4>
                        
                        <div className="grid grid-cols-1 gap-2.5">
                          {/* Local Public */}
                          <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                            <div>
                              <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Local (You)</div>
                              <div className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                                {stunLocalIPs.length > 0 ? stunLocalIPs[0].ip : 'Pending STUN response...'}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-bold uppercase">
                              STUN IP
                            </span>
                          </div>

                          {/* Remote Public */}
                          <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                            <div>
                              <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Remote (Peer)</div>
                              <div className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                                {stunRemoteIPs.length > 0 ? stunRemoteIPs[0].ip : 'Waiting for peer handshake...'}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-bold uppercase">
                              STUN IP
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2. LOCAL LAN INTERFACES */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                          <Network className="h-3.5 w-3.5 text-emerald-400" />
                          Local LAN / WiFi Interfaces
                        </h4>
                        
                        <div className="grid grid-cols-1 gap-2.5">
                          {/* Local LAN */}
                          <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                            <div>
                              <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Local Router Card</div>
                              <div className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                                {hostLocalIPs.length > 0 ? hostLocalIPs[0].ip : 'Pending interface scan...'}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-bold uppercase">
                              LAN Host
                            </span>
                          </div>

                          {/* Remote LAN */}
                          <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl flex justify-between items-center">
                            <div>
                              <div className="text-[10px] font-mono text-slate-500 uppercase font-semibold">Remote Router Card</div>
                              <div className="text-sm font-mono font-bold text-slate-200 mt-0.5">
                                {hostRemoteIPs.length > 0 ? hostRemoteIPs[0].ip : 'Waiting for candidate...'}
                              </div>
                            </div>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded-md font-bold uppercase">
                              LAN Host
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* CANDIDATE RAW LEDGER */}
                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                        Discovered ICE Candidates Ledger ({parsedCandidates.length})
                      </h4>
                      {parsedCandidates.length === 0 ? (
                        <div className="bg-slate-950/50 rounded-xl p-6 text-center text-xs text-slate-600 font-mono">
                          No candidates compiled yet. Establish a connection to start the ledger.
                        </div>
                      ) : (
                        <div className="border border-slate-800 rounded-xl overflow-hidden text-xs">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-950 text-slate-400 font-mono font-bold uppercase tracking-wider border-b border-slate-800">
                                <th className="px-3 py-2">Origin</th>
                                <th className="px-3 py-2">Parsed Network IP</th>
                                <th className="px-3 py-2">Port</th>
                                <th className="px-3 py-2">Type</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60 bg-slate-950/20 font-mono">
                              {parsedCandidates.map((cand) => (
                                <tr key={cand.id} className="hover:bg-slate-900/40">
                                  <td className="px-3 py-2">
                                    <span className={`font-bold uppercase ${
                                      cand.origin === 'local' ? 'text-teal-400' : 'text-indigo-400'
                                    }`}>
                                      {cand.origin}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-slate-200 truncate max-w-[140px] font-bold" title={cand.ip}>
                                    {cand.ip}
                                  </td>
                                  <td className="px-3 py-2 text-slate-400">{cand.port}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                      cand.type === 'host' ? 'bg-emerald-950/80 border border-emerald-900 text-emerald-400' :
                                      cand.type === 'srflx' ? 'bg-indigo-950/80 border border-indigo-900 text-indigo-400' :
                                      'bg-slate-800 text-slate-400'
                                    }`}>
                                      {cand.type}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* --- TAB 3: REAL-TIME SIGNALLING EVENT LOG --- */}
                {activeTab === 'logs' && (
                  <div className="flex-1 flex flex-col min-h-0" id="logs_panel">
                    
                    {/* Log operations bar */}
                    <div className="flex items-center justify-between border-b border-slate-800/80 pb-3 mb-3 shrink-0">
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                        Handshake & Connection Logging
                      </span>
                      <button
                        onClick={() => setLogs([])}
                        className="text-[10px] font-mono font-bold uppercase px-2.5 py-1 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer"
                        id="clear_logs_btn"
                      >
                        Clear console
                      </button>
                    </div>

                    {/* Logs console */}
                    <div className="flex-1 bg-slate-950 border border-slate-850 p-4 rounded-2xl overflow-y-auto font-mono text-[11px] leading-relaxed space-y-1.5 scrollbar-thin scrollbar-thumb-slate-800" id="logs_console">
                      {logs.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-600 text-center text-xs">
                          No logs compiled. Connection activities will print in real time.
                        </div>
                      ) : (
                        logs.map((log) => (
                          <div key={log.id} className="flex gap-2.5 items-start">
                            <span className="text-slate-500 shrink-0 font-medium">{log.timestamp}</span>
                            <span className={`shrink-0 font-bold ${
                              log.type === 'success' ? 'text-emerald-400' :
                              log.type === 'error' ? 'text-rose-400' :
                              log.type === 'warn' ? 'text-amber-400' :
                              log.type === 'signal' ? 'text-purple-400 font-extrabold' : 'text-sky-400'
                            }`}>
                              [{log.type.toUpperCase()}]
                            </span>
                            <span className="text-slate-300 break-words">{log.message}</span>
                          </div>
                        ))
                      )}
                      <div ref={logEndRef} />
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        )}
      </main>

      {/* FOOTER BAR */}
      <footer className="border-t border-slate-900 bg-slate-950 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0 text-xs text-slate-500 mt-auto" id="app_footer">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-teal-500/60" />
          <span>Distributed P2P framework secured by browser sandbox WebRTC policies.</span>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <span>v1.0.0</span>
          <span className="text-slate-800">|</span>
          <span className="hover:text-slate-300 transition-all cursor-pointer">Documentation</span>
        </div>
      </footer>
    </div>
  );
}
