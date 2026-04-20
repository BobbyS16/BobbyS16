import { useState } from "react";

export default function ResultActions({ result, onDelete, onEdit }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      <button
        onClick={() => onEdit(result)}
        style={{
          flex: 1, padding: "6px", borderRadius: 8,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.15)",
          color: "#fff", fontSize: 12, cursor: "pointer"
        }}>
        ✏️ Modifier
      </button>
      {!showConfirm ? (
        <button
          onClick={() => setShowConfirm(true)}
          style={{
            flex: 1, padding: "6px", borderRadius: 8,
            background: "rgba(230,57,70,0.15)",
            border: "1px solid rgba(230,57,70,0.3)",
            color: "#E63946", fontSize: 12, cursor: "pointer"
          }}>
          🗑️ Supprimer
        </button>
      ) : (
        <button
          onClick={() => { onDelete(result.id); setShowConfirm(false); }}
          style={{
            flex: 1, padding: "6px", borderRadius: 8,
            background: "#E63946", border: "none",
            color: "#fff", fontSize: 12, cursor: "pointer"
          }}>
          Confirmer ?
        </button>
      )}
    </div>
  );
}
