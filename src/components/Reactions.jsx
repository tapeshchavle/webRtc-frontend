import React, { useState, useEffect, useCallback } from 'react';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🤔', '😮', '🔥'];

let reactionIdCounter = 0;

function FloatingReaction({ emoji, onDone }) {
  const [style] = useState(() => ({
    left: `${20 + Math.random() * 60}%`,
    animationDuration: `${2 + Math.random() * 1.5}s`,
    animationDelay: `${Math.random() * 0.3}s`,
    fontSize: `${1.5 + Math.random() * 1}rem`,
  }));

  useEffect(() => {
    const timer = setTimeout(onDone, 4000);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="floating-reaction" style={style}>
      {emoji}
    </div>
  );
}

export function ReactionsOverlay({ reactions, onReactionDone }) {
  return (
    <div className="reactions-overlay">
      {reactions.map(r => (
        <FloatingReaction
          key={r.id}
          emoji={r.emoji}
          onDone={() => onReactionDone(r.id)}
        />
      ))}
    </div>
  );
}

export default function ReactionsPicker({ onSendReaction, isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="reactions-picker">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-btn"
          onClick={() => {
            onSendReaction(emoji);
            onClose();
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function useReactions(stompClient, roomId, myId) {
  const [reactions, setReactions] = useState([]);

  const addReaction = useCallback((emoji, senderId) => {
    const id = ++reactionIdCounter;
    setReactions(prev => [...prev, { id, emoji, senderId }]);
  }, []);

  const removeReaction = useCallback((id) => {
    setReactions(prev => prev.filter(r => r.id !== id));
  }, []);

  const sendReaction = useCallback((emoji) => {
    if (stompClient) {
      stompClient.publish({
        destination: `/app/peer/${roomId}`,
        body: JSON.stringify({ type: 'reaction', emoji, sender: myId }),
      });
    }
    // Show locally too
    addReaction(emoji, myId);
  }, [stompClient, roomId, myId, addReaction]);

  return { reactions, addReaction, removeReaction, sendReaction };
}
