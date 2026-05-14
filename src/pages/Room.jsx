import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';

export default function Room() {
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    // Video refs
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    
    // WebRTC connections
    const stompClientRef = useRef(null);
    const peerConnectionRef = useRef(null);
    
    // States
    const [connected, setConnected] = useState(false);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [isVideoEnabled, setIsVideoEnabled] = useState(true);
    
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
            if (peerConnectionRef.current) peerConnectionRef.current.close();
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
                    } else {
                        handleSignalingData(data);
                    }
                });
                
                // Say hello
                client.publish({
                    destination: `/app/peer/${roomId}`,
                    body: JSON.stringify({ type: 'join', sender: myId })
                });
            }
        });
        
        client.activate();
        stompClientRef.current = client;
    };

    const getPeerConnection = () => {
        if (!peerConnectionRef.current) {
            const pc = new RTCPeerConnection(configuration);
            peerConnectionRef.current = pc;

            pc.onicecandidate = (event) => {
                if (event.candidate && stompClientRef.current) {
                    stompClientRef.current.publish({
                        destination: `/app/peer/${roomId}`,
                        body: JSON.stringify({ type: 'candidate', candidate: event.candidate, sender: myId })
                    });
                }
            };

            pc.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            };

            const localStream = localVideoRef.current.srcObject;
            if (localStream) {
                localStream.getTracks().forEach(track => {
                    pc.addTrack(track, localStream);
                });
            }
        }
        return peerConnectionRef.current;
    };

    const handleSignalingData = async (data) => {
        if (data.type === 'join') {
            const pc = getPeerConnection();
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'offer', offer: pc.localDescription, sender: myId })
            });
        } 
        else if (data.type === 'offer') {
            const pc = getPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            stompClientRef.current.publish({
                destination: `/app/peer/${roomId}`,
                body: JSON.stringify({ type: 'answer', answer: pc.localDescription, sender: myId })
            });
        } 
        else if (data.type === 'answer') {
            const pc = getPeerConnection();
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } 
        else if (data.type === 'candidate' && data.candidate) {
            const pc = getPeerConnection();
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
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
                <div className="video-grid">
                    <div className="video-wrapper">
                        <video ref={localVideoRef} autoPlay muted playsInline />
                        <div className="video-badge">You {!isAudioEnabled && '🔇'} </div>
                    </div>
                    {/* The remote video is permanently in the grid once a track arrives */}
                    <div className="video-wrapper">
                        <video ref={remoteVideoRef} autoPlay playsInline />
                        <div className="video-badge">Remote {!connected && '(Waiting for peer)'}</div>
                    </div>
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
                        <button className="ctrl-btn leave-btn" onClick={() => navigate('/')}>
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
                                <div className="message-sender">{m.sender === myId ? 'You' : 'Peer'}</div>
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
