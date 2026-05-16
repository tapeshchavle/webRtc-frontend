import React from 'react';
import { MicIcon, MicOffIcon, VideocamIcon, VideocamOffIcon, PinIcon, CloseIcon } from './Icons';

export default function ParticipantsPanel({ participants, localMutedPeers, onToggleMute, onPin, onClose }) {
  return (
    <div className="participants-panel">
      <div className="panel-header">
        <h3>People ({participants.length})</h3>
        <button className="panel-close-btn" onClick={onClose}>
          <CloseIcon size={20} />
        </button>
      </div>
      <div className="participants-list">
        {participants.map((p) => (
          <div className="participant-item" key={p.id}>
            <div className="participant-avatar">
              {p.name.charAt(0).toUpperCase()}
            </div>
            <div className="participant-info">
              <span className="participant-name">{p.name}</span>
              {p.isLocal && <span className="participant-you">(You)</span>}
            </div>
            <div className="participant-actions">
              {p.hasAudio ? (
                <MicIcon size={18} style={{ color: '#81c995', opacity: 0.8 }} />
              ) : (
                <MicOffIcon size={18} style={{ color: '#f28b82', opacity: 0.8 }} />
              )}
              {p.hasVideo ? (
                <VideocamIcon size={18} style={{ color: '#81c995', opacity: 0.8 }} />
              ) : (
                <VideocamOffIcon size={18} style={{ color: '#f28b82', opacity: 0.8 }} />
              )}
              {!p.isLocal && (
                <button className="participant-pin-btn" onClick={() => onPin(p.id)} title="Pin">
                  <PinIcon size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
