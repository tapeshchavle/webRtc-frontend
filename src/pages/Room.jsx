import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';

export default function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    // Video refs & states
    const localVideoRef = useRef(null);
    const localStreamRef = useRef(null);
    const screenStreamRef = useRef(null);
    const [remoteStreams, setRemoteStreams] = useState({}); // mapping peerId -> mediaStream
    
    // WebRTC connections map: peerId -> RTCPeerConnection
    const peerConnectionsRef = useRef({});
    const stompClientRef = useRef(null);
    
    // States
    const [connected, setConnected] = useState(false);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [pinnedPeer, setPinnedPeer] = useState(null);
    const [localMutedPeers, setLocalMutedPeers] = useState(new Set());
    
    // Chat states
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [currentMessage, setCurrentMessage] = useState('');
    
    const myId = useRef(Math.random().toString(36).substring(7)).current;

    const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    useEffect(() => {
        startLocalStream().then(() => {
            connectStomp();
        });

        return () => {
            if (stompClientRef.current) stompClientRef.current.deactivate();
            Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
            if (localVideoRef.current && localVideoRef.current.srcObject) {
                localVideoRef.current.srcObject.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const startLocalStream = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoRef.current) {
                 localVideoRef.current.srcObject = stream;
            }
            localStreamRef.current = stream;
        } catch(e) {
            console.error('Error accessing media', e);
            alert("Could not access camera or microphone!");
        }
    };

    const connectStomp = () => {
        const client = new Client({
            webSocketFactory: () => new SockJS('https://webrtc-hzhad3hdhnffcbe5.centralindia-01.azurewebsites.net/webrtc-signaling'),
            reconnectDelay: 5000,
            onConnect: () => {
                setConnected(true);
                
                client.subscribe(`/topic/room/${roomId}`, (msg) => {
                    const data = JSON.parse(msg.body);
                    const screenId = myId + '_scr';
                    if (data.sender === myId || data.sender === screenId) return; 

                    if (data.type === 'chat') {
                        setMessages(prev => [...prev, data]);
                    } else if (data.target === myId || data.target === screenId || data.type === 'join' || data.type === 'leave') {
                        // Only process signaling data if it's meant for us, or a broadcast join/leave
                        handleSignalingData(data);
                    }
                });
                
                // Say hello to everyone in the room
                client.publish({
                    destination: `/app/peer/${roomId}`,
                    body: JSON.stringify({ type: 'join', sender: myId })
                });
            }
        });
        
        client.activate();
        stompClientRef.current = client;
    };

    const createPeerConnection = (pcKey, isForMyScreen = false, senderId = null, remoteTargetId = null) => {
        if (!senderId) senderId = myId;
        if (!remoteTargetId) remoteTargetId = pcKey;

        if (peerConnectionsRef.current[pcKey]) {
            return peerConnectionsRef.current[pcKey];
        }

        const pc = new RTCPeerConnection(configuration);
        peerConnectionsRef.current[pcKey] = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate && stompClientRef.current) {
                stompClientRef.current.publish({
                    destination: `/app/peer/${roomId}`,
                    body: JSON.stringify({ type: 'candidate', candidate: event.candidate, sender: senderId, target: remoteTargetId })
                });
            }
        };

        pc.ontrack = (event) => {
            setRemoteStreams(prev => ({ ...prev, [pcKey]: event.streams[0] }));
        };

        if (isForMyScreen) {
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => {
                    pc.addTrack(track, screenStreamRef.current);
                });
            }
        } else {
            const isRemoteScreen = remoteTargetId && remoteTargetId.endsWith('_scr');
            if (!isRemoteScreen) {
                const cameraStream = localStreamRef.current;
                if (cameraStream) {
                    cameraStream.getTracks().forEach(track => {
                        pc.addTrack(track, cameraStream);
                    });
                }
            } else {
                // When connecting to a remote screen share, add recvonly transceivers
                // so the SDP offer includes video/audio media lines for the sharer to send into.
                // Without this, the offer has NO media sections and the sharer can't answer with video.
                pc.addTransceiver('video', { direction: 'recvonly' });
                pc.addTransceiver('audio', { direction: 'recvonly' });
            }
        }

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                removePeer(pcKey);
            }
        };

        return pc;
    };

    const removePeer = (peerId) => {
        if (peerConnectionsRef.current[peerId]) {
            peerConnectionsRef.current[peerId].close();
            delete peerConnectionsRef.current[peerId];
        }
        setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[peerId];
            return newStreams;
        });
    };

    const handleSignalingData = async (data) => {
        const { sender, type, target } = data;
        const screenId = myId + '_scr';

        if (type === 'join') {
            // Someone joined, let's create a PC and send an offer to them
            const pc = createPeerConnection(sender, false, myId, sender);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'offer', offer: pc.localDescription, sender: myId, target: sender })
            });

            if (isScreenSharing && screenStreamRef.current) {
                const pc2 = createPeerConnection('screen_out_' + sender, true, screenId, sender);
                const offer2 = await pc2.createOffer();
                await pc2.setLocalDescription(offer2);
                stompClientRef.current.publish({
                    destination: `/app/peer/${roomId}`,
                    body: JSON.stringify({ type: 'offer', offer: pc2.localDescription, sender: screenId, target: sender })
                });
            }
        } 
        else if (type === 'offer') {
            // Someone sent an offer to us
            const isForMyScreen = target === screenId;
            const pcKey = isForMyScreen ? sender + '_for_my_screen' : sender;
            const pc = createPeerConnection(pcKey, isForMyScreen, target || myId, sender);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'answer', answer: pc.localDescription, sender: target || myId, target: sender })
            });
        } 
        else if (type === 'answer') {
            // Someone answered our offer
            const isForMyScreen = target === screenId;
            const pcKey = isForMyScreen ? 'screen_out_' + sender : sender;
            const pc = peerConnectionsRef.current[pcKey];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        } 
        else if (type === 'candidate' && data.candidate) {
            // ICE candidate for a specific connection
            const isForMyScreen = target === screenId;
            let pcKey = sender;
            if (isForMyScreen) {
                 if (peerConnectionsRef.current['screen_out_' + sender]) pcKey = 'screen_out_' + sender;
                 else pcKey = sender + '_for_my_screen';
            }
            const pc = peerConnectionsRef.current[pcKey];
            if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        }
        else if (type === 'leave') {
            removePeer(sender);
            removePeer('screen_out_' + sender);
            removePeer(sender + '_for_my_screen');
        }
    };

    const leaveRoom = () => {
        if (stompClientRef.current) {
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'leave', sender: myId })
            });
        }
        navigate('/');
    };

    const toggleScreenShare = async () => {
        if (!isScreenSharing) {
            try {
                const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                const screenTrack = screenStream.getVideoTracks()[0];
                const screenId = myId + '_scr';

                screenTrack.onended = () => {
                    stopScreenShare();
                };

                // Add stream to local state so we can render it without replacing local webcam
                setRemoteStreams(prev => ({ ...prev, [screenId]: screenStream }));
                
                screenStreamRef.current = screenStream;
                setIsScreenSharing(true);

                if (stompClientRef.current) {
                    stompClientRef.current.publish({
                        destination: `/app/peer/${roomId}`,
                        body: JSON.stringify({ type: 'join', sender: screenId })
                    });
                }
            } catch (e) {
                console.error('Failed to share screen', e);
            }
        } else {
            stopScreenShare();
        }
    };

    const stopScreenShare = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
        
        const screenId = myId + '_scr';
        setRemoteStreams(prev => {
            const newStreams = { ...prev };
            delete newStreams[screenId];
            return newStreams;
        });

        setIsScreenSharing(false);
        if (stompClientRef.current) {
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'leave', sender: screenId })
            });
        }
    };

    const toggleAudio = () => {
        const stream = localStreamRef.current;
        if (stream) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsAudioEnabled(audioTrack.enabled);
            }
        }
    };

    const toggleVideo = () => {
        const stream = localStreamRef.current;
        if (stream) {
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setIsVideoEnabled(videoTrack.enabled);
            }
        }
    };

    const togglePin = (id) => {
        setPinnedPeer(prev => prev === id ? null : id);
    };

    const toggleLocalMute = (e, id) => {
        e.stopPropagation();
        setLocalMutedPeers(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const sendMessage = (e) => {
        e.preventDefault();
        if (!currentMessage.trim() || !stompClientRef.current) return;

        const chatObj = { type: 'chat', text: currentMessage, sender: myId };
        
        stompClientRef.current.publish({
            destination: `/app/peer/${roomId}`,
            body: JSON.stringify(chatObj)
        });

        // Add our own message locally since we ignore echoed msgs
        setMessages(prev => [...prev, chatObj]);
        setCurrentMessage('');
    };

    return (
        <div className="room-container">
            <div className="video-area">
                <div className={`video-grid ${pinnedPeer ? 'pinned-layout' : ''}`}>
                    <div className={`video-wrapper ${pinnedPeer === 'local' ? 'pinned' : ''}`} onClick={() => togglePin('local')}>
                        <video ref={localVideoRef} autoPlay muted playsInline />
                        <div className="video-badge">You {!isAudioEnabled && '🔇'} </div>
                    </div>
                    {/* Render a video wrapper for every remote peer connected */}
                    {Object.entries(remoteStreams).map(([peerId, stream]) => (
                        <div className={`video-wrapper ${pinnedPeer === peerId ? 'pinned' : ''} ${peerId.endsWith('_scr') ? 'screen-share' : ''}`} key={peerId} onClick={() => togglePin(peerId)}>
                            <video
                                autoPlay
                                playsInline
                                muted={localMutedPeers.has(peerId) || peerId === myId + '_scr'}
                                ref={el => {
                                    if (el && el.srcObject !== stream) {
                                        el.srcObject = stream;
                                    }
                                }}
                            />
                            <div className="video-badge">
                                {peerId === myId + '_scr' ? 'Your Screen' : peerId.endsWith('_scr') ? `Peer Screen (${peerId.substring(0,4)})` : `Peer (${peerId.substring(0,4)})`}
                            </div>
                            <button className="mute-overlay-btn" onClick={(e) => toggleLocalMute(e, peerId)}>
                                {localMutedPeers.has(peerId) ? '🔇' : '🔊'}
                            </button>
                        </div>
                    ))}
                    
                    {Object.keys(remoteStreams).length === 0 && !pinnedPeer && (
                        <div className="video-wrapper" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#3c4043'}}>
                            <div style={{color: '#9aa0a6'}}>Waiting for people to join...</div>
                        </div>
                    )}
                </div>

                <div className="bottom-controls">
                    <div className="meeting-info">
                        <strong>Room Code: {roomId}</strong>
                        <span style={{marginLeft: '10px'}}>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>

                    <div className="control-buttons">
                        <button className={`ctrl-btn ${!isAudioEnabled ? 'off' : ''}`} onClick={toggleAudio}>
                            {isAudioEnabled ? '🎙️' : '🔇'}
                        </button>
                        <button className={`ctrl-btn ${!isVideoEnabled ? 'off' : ''}`} onClick={toggleVideo}>
                            {isVideoEnabled ? '📷' : '🚫'}
                        </button>
                        <button className={`ctrl-btn ${isScreenSharing ? 'off' : ''}`} onClick={toggleScreenShare}>
                            {isScreenSharing ? '🖥️' : '💻'}
                        </button>
                        <button className="ctrl-btn leave-btn" onClick={leaveRoom}>
                            ☎️
                        </button>
                    </div>

                    <div className="control-buttons">
                        <button className="ctrl-btn" style={{backgroundColor: isChatOpen ? '#8ab4f8' : '#3c4043'}} onClick={() => setIsChatOpen(!isChatOpen)}>
                            💬
                        </button>
                    </div>
                </div>
            </div>

            {isChatOpen && (
                <div className="chat-sidebar">
                    <div className="chat-header">
                        <h3>In-call messages</h3>
                        <button style={{background:'none', border:'none', fontSize:'1.2rem', cursor:'pointer'}} onClick={() => setIsChatOpen(false)}>✖</button>
                    </div>
                    
                    <div className="chat-messages">
                        <div style={{fontSize: '0.85rem', color: '#5f6368', textAlign: 'center', marginBottom: '10px'}}>
                            Messages can be seen by people in the call.
                        </div>
                        {messages.map((m, i) => (
                            <div key={i} className={`message-bubble ${m.sender === myId ? 'mine' : ''}`}>
                                <div className="message-sender">{m.sender === myId ? 'You' : m.sender.substring(0,4)}</div>
                                <div>{m.text}</div>
                            </div>
                        ))}
                    </div>

                    <form className="chat-input" onSubmit={sendMessage}>
                        <input 
                            type="text" 
                            placeholder="Send a message to everyone" 
                            value={currentMessage}
                            onChange={(e) => setCurrentMessage(e.target.value)}
                        />
                        <button type="submit">▶</button>
                    </form>
                </div>
            )}
        </div>
    );
}
