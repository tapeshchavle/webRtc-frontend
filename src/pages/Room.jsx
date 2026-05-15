import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';

export default function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    // Video refs & states
    const localVideoRef = useRef(null);
    const [remoteStreams, setRemoteStreams] = useState({}); // mapping peerId -> mediaStream
    
    // WebRTC connections map: peerId -> RTCPeerConnection
    const peerConnectionsRef = useRef({});
    const stompClientRef = useRef(null);
    
    // States
    const [connected, setConnected] = useState(false);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
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
                    if (data.sender === myId) return; 

                    if (data.type === 'chat') {
                        setMessages(prev => [...prev, data]);
                    } else if (data.target === myId || data.type === 'join' || data.type === 'leave') {
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

    const createPeerConnection = (peerId) => {
        if (peerConnectionsRef.current[peerId]) {
            return peerConnectionsRef.current[peerId];
        }

        const pc = new RTCPeerConnection(configuration);
        peerConnectionsRef.current[peerId] = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate && stompClientRef.current) {
                stompClientRef.current.publish({
                    destination: `/app/peer/${roomId}`,
                    body: JSON.stringify({ type: 'candidate', candidate: event.candidate, sender: myId, target: peerId })
                });
            }
        };

        pc.ontrack = (event) => {
            setRemoteStreams(prev => ({ ...prev, [peerId]: event.streams[0] }));
        };

        const localStream = localVideoRef.current?.srcObject;
        if (localStream) {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        }

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'closed') {
                removePeer(peerId);
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
        const { sender, type } = data;

        if (type === 'join') {
            // Someone joined, let's create a PC and send an offer to them
            const pc = createPeerConnection(sender);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'offer', offer: pc.localDescription, sender: myId, target: sender })
            });
        } 
        else if (type === 'offer') {
            // Someone sent an offer to us
            const pc = createPeerConnection(sender);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'answer', answer: pc.localDescription, sender: myId, target: sender })
            });
        } 
        else if (type === 'answer') {
            // Someone answered our offer
            const pc = peerConnectionsRef.current[sender];
            if (pc) {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            }
        } 
        else if (type === 'candidate' && data.candidate) {
            // ICE candidate for a specific connection
            const pc = peerConnectionsRef.current[sender];
            if (pc) {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        }
        else if (type === 'leave') {
            removePeer(sender);
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

    const toggleAudio = () => {
        const stream = localVideoRef.current?.srcObject;
        if (stream) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setIsAudioEnabled(audioTrack.enabled);
            }
        }
    };

    const toggleVideo = () => {
        const stream = localVideoRef.current?.srcObject;
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
                        <div className={`video-wrapper ${pinnedPeer === peerId ? 'pinned' : ''}`} key={peerId} onClick={() => togglePin(peerId)}>
                            <video
                                autoPlay
                                playsInline
                                muted={localMutedPeers.has(peerId)}
                                ref={el => {
                                    if (el && el.srcObject !== stream) {
                                        el.srcObject = stream;
                                    }
                                }}
                            />
                            <div className="video-badge">Peer ({peerId.substring(0,4)})</div>
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
