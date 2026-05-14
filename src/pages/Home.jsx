import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

function Home() {
  const navigate = useNavigate();
  const [roomIdToJoin, setRoomIdToJoin] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');

  const API_BASE = 'https://webrtc-hzhad3hdhnffcbe5.centralindia-01.azurewebsites.net/api/meetings';

  const scheduleMeeting = async () => {
    try {
      const resp = await axios.post(`${API_BASE}/schedule`, {
        title: "Instant Meeting",
        hostName: "Host"
      });
      const roomId = resp.data.roomId;
      const link = `${window.location.origin}/room/${roomId}`;
      setGeneratedLink(link);
    } catch (e) {
      console.error(e);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedLink);
    alert('Meeting link copied to clipboard!');
  };

  const joinRoom = (e) => {
    e.preventDefault();
    if(roomIdToJoin) {
      // support clicking full url or code
      const code = roomIdToJoin.split('/').pop();
      navigate(`/room/${code}`);
    }
  };

  return (
    <div className="home-container">
      <header className="home-header">
        <h2>🎥 Video Streaming Platform</h2>
        <div style={{color: '#5f6368'}}>{new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      </header>
      
      <main className="home-main">
        <div className="home-left">
          <h1>Premium video meetings. Now free for everyone.</h1>
          <p>We re-engineered the service we built for secure business meetings, to make it free and available for all.</p>
          
          <div className="action-buttons">
            <button className="btn-primary" onClick={scheduleMeeting}>
              ➕ New meeting
            </button>
            
            <form onSubmit={joinRoom} className="input-group" style={{maxWidth: '300px'}}>
              <span style={{color: '#5f6368', paddingLeft: '8px'}}>⌨️</span>
              <input 
                value={roomIdToJoin} 
                onChange={e => setRoomIdToJoin(e.target.value)} 
                placeholder="Enter a code or link" 
                required
              />
              {roomIdToJoin && <button className="join-btn" type="submit">Join</button>}
            </form>
          </div>

          {generatedLink && (
            <div style={{marginTop: '20px', padding: '15px', border: '1px solid #dadce0', borderRadius: '4px'}}>
              <p style={{margin: '0 0 10px 0', fontSize: '1rem', color: '#202124'}}>Here's the link to your meeting</p>
              <p style={{color: '#5f6368', fontSize: '0.9rem', marginBottom: '10px'}}>Copy this link and send it to people you want to meet with. Be sure to save it so you can use it later, too.</p>
              <div style={{background: '#f1f3f4', padding: '10px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <span style={{wordBreak: 'break-all'}}>{generatedLink}</span>
                <button onClick={copyToClipboard} className="btn-secondary" style={{marginLeft: '10px'}}>📋 Copy</button>
              </div>
            </div>
          )}
        </div>
        
        <div className="home-right" style={{textAlign: 'center'}}>
          <img 
            src="https://www.gstatic.com/meet/user_edu_get_a_link_light_90698cd7b4ca04d3005c962a3756c42d.svg" 
            alt="Meet graphic"
            style={{maxWidth: '100%', borderRadius: '50%'}}
          />
        </div>
      </main>
    </div>
  );
}

export default Home;
