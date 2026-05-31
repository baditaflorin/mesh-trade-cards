import { useEffect, useMemo, useState } from "react";
import {
  MeshNameInput,
  QRExchange,
  makeScanPayload,
  type MeshConfig,
  type YRoom,
} from "@baditaflorin/mesh-common";

type Props = { room: YRoom | null; config: MeshConfig };
type Holding = { cardId: number; name: string };
// A trade is a pending, two-sided agreement between peers `a` and `b`
// (a < b lexicographically). It only swaps when BOTH have confirmed.
type Trade = {
  a: string;
  b: string;
  confirmA: boolean;
  confirmB: boolean;
  ts: number;
  done?: boolean;
};

const NAME_KEY = (p: string) => `${p}:displayName`;

const CARDS = [
  { id: 0, name: "Comet 🌠", rarity: "rare" },
  { id: 1, name: "Phoenix 🦤", rarity: "rare" },
  { id: 2, name: "Kraken 🐙", rarity: "epic" },
  { id: 3, name: "Bear 🐻", rarity: "common" },
  { id: 4, name: "Fox 🦊", rarity: "common" },
  { id: 5, name: "Wolf 🐺", rarity: "uncommon" },
  { id: 6, name: "Owl 🦉", rarity: "uncommon" },
  { id: 7, name: "Dragon 🐉", rarity: "epic" },
  { id: 8, name: "Mushroom 🍄", rarity: "common" },
  { id: 9, name: "Coral 🪸", rarity: "uncommon" },
  { id: 10, name: "Tiger 🐯", rarity: "rare" },
  { id: 11, name: "Whale 🐋", rarity: "epic" },
  { id: 12, name: "Llama 🦙", rarity: "common" },
  { id: 13, name: "Lobster 🦞", rarity: "uncommon" },
  { id: 14, name: "Crab 🦀", rarity: "common" },
  { id: 15, name: "Star ⭐", rarity: "common" },
];

function hashPeer(peerId: string): number {
  let h = 5381;
  for (let i = 0; i < peerId.length; i++) h = (h * 33 + peerId.charCodeAt(i)) >>> 0;
  return h;
}

// Deterministic, order-independent key + role for a pair of peers, so both
// sides write into the SAME trade record regardless of who scans first.
function pairKey(p1: string, p2: string): { key: string; a: string; b: string } {
  const [a, b] = p1 < p2 ? [p1, p2] : [p2, p1];
  return { key: `${a}|${b}`, a, b };
}

export function Feature({ room, config }: Props) {
  if (!room) {
    return (
      <div className="viral-screen">
        <h1>trade cards</h1>
        <p className="viral-status">Connecting…</p>
      </div>
    );
  }
  return <Body room={room} config={config} />;
}

function Body({ room, config }: { room: YRoom; config: MeshConfig }) {
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY(config.storagePrefix)) ?? "",
  );
  const [, rerender] = useState(0);

  useEffect(() => {
    if (name) localStorage.setItem(NAME_KEY(config.storagePrefix), name);
  }, [name, config.storagePrefix]);

  useEffect(() => {
    const h = room.doc.getMap<Holding>("holdings");
    const t = room.doc.getMap<Trade>("trades");
    const cb = () => rerender((n) => n + 1);
    h.observe(cb);
    t.observe(cb);
    return () => {
      h.unobserve(cb);
      t.unobserve(cb);
    };
  }, [room]);

  const holdings = room.doc.getMap<Holding>("holdings");
  const trades = room.doc.getMap<Trade>("trades");

  // initial deal: each peer gets a card deterministic from peerId
  useEffect(() => {
    if (!name.trim()) return;
    if (!holdings.has(room.peerId)) {
      const cardId = hashPeer(room.peerId) % CARDS.length;
      holdings.set(room.peerId, { cardId, name: name.trim() });
    } else {
      const cur = holdings.get(room.peerId)!;
      if (cur.name !== name.trim()) {
        holdings.set(room.peerId, { ...cur, name: name.trim() });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, room.peerId]);

  const my = holdings.get(room.peerId);
  const myCard = my ? CARDS[my.cardId] : null;

  // Confirm my side of a trade with `otherId`. The swap only executes once
  // BOTH peers have confirmed the same pending trade — a one-sided confirm
  // records intent but never moves a card.
  const confirmTrade = (otherId: string) => {
    if (!my || otherId === room.peerId) return;
    if (!holdings.has(otherId)) return;
    const { key, a, b } = pairKey(room.peerId, otherId);
    room.doc.transact(() => {
      const existing = trades.get(key);
      if (existing?.done) return; // already settled this pair
      const iAmA = room.peerId === a;
      const next: Trade = existing
        ? { ...existing }
        : { a, b, confirmA: false, confirmB: false, ts: Date.now() };
      if (iAmA) next.confirmA = true;
      else next.confirmB = true;

      if (next.confirmA && next.confirmB) {
        // Mutual confirm reached → perform the swap exactly once.
        const ha = holdings.get(a);
        const hb = holdings.get(b);
        if (ha && hb) {
          holdings.set(a, { ...ha, cardId: hb.cardId });
          holdings.set(b, { ...hb, cardId: ha.cardId });
        }
        next.done = true;
      }
      trades.set(key, next);
    });
  };

  const cancelTrade = (otherId: string) => {
    const { key } = pairKey(room.peerId, otherId);
    const existing = trades.get(key);
    if (existing && !existing.done) trades.delete(key);
  };

  const myPayload = makeScanPayload(room.roomId, room.peerId, name.trim() || "anon");

  // Pending trades that involve me and are not yet settled.
  const myPending: Array<{ otherId: string; trade: Trade; iConfirmed: boolean }> = [];
  trades.forEach((tr, key) => {
    if (tr.done) return;
    if (tr.a !== room.peerId && tr.b !== room.peerId) return;
    const otherId = tr.a === room.peerId ? tr.b : tr.a;
    const iConfirmed = tr.a === room.peerId ? tr.confirmA : tr.confirmB;
    void key;
    myPending.push({ otherId, trade: tr, iConfirmed });
  });

  const inventory = useMemo(() => {
    const set = new Set<number>();
    holdings.forEach((h) => set.add(h.cardId));
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, holdings.size, holdings.get(room.peerId)?.cardId]);

  const allHoldings: Array<Holding & { peerId: string }> = [];
  holdings.forEach((h, k) => allHoldings.push({ ...h, peerId: k }));

  return (
    <div className="viral-screen">
      <header>
        <h1>trade cards</h1>
        <p className="viral-status">
          {holdings.size} players · {inventory.size}/{CARDS.length} unique cards in play
        </p>
      </header>

      <MeshNameInput
        value={name}
        onChange={setName}
        placeholder="your name"
        maxLength={48}
        className="viral-name"
      />

      <section>
        <h2 className="viral-section-title">your card</h2>
        {myCard ? (
          <div className={`tc-card tc-${myCard.rarity}`}>
            <div className="tc-name">{myCard.name}</div>
            <div className="tc-rarity">{myCard.rarity}</div>
          </div>
        ) : (
          <p className="viral-empty">set a name to be dealt a card</p>
        )}
      </section>

      <QRExchange
        myPayload={myPayload}
        showLabel="your QR — show to start a trade"
        scanLabel="scan to confirm a trade"
        onScan={(parsed) => confirmTrade(parsed.peerId)}
      />

      <section>
        <h2 className="viral-section-title">pending trades ({myPending.length})</h2>
        {myPending.length === 0 ? (
          <p className="viral-empty">
            none — scan a peer's QR (or use the confirm button) to start one
          </p>
        ) : (
          <ul className="tc-offers">
            {myPending.map(({ otherId, trade, iConfirmed }) => {
              const them = holdings.get(otherId);
              const theirCard = them ? CARDS[them.cardId] : null;
              const otherConfirmed = trade.a === otherId ? trade.confirmA : trade.confirmB;
              return (
                <li key={otherId} className="tc-trade" data-peer={otherId}>
                  <strong>{them?.name ?? "?"}</strong> · <em>{theirCard?.name ?? "?"}</em>{" "}
                  <span className="tc-trade-status">
                    {iConfirmed ? "you ✓" : "you ✗"} · {otherConfirmed ? "them ✓" : "them ✗"}
                  </span>{" "}
                  {!iConfirmed && (
                    <button
                      type="button"
                      className="viral-primary tc-confirm"
                      onClick={() => confirmTrade(otherId)}
                    >
                      confirm
                    </button>
                  )}{" "}
                  <button
                    type="button"
                    className="viral-ghost tc-cancel"
                    onClick={() => cancelTrade(otherId)}
                  >
                    cancel
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="viral-section-title">all holdings</h2>
        <ul className="tc-holdings">
          {allHoldings.map((h) => {
            const c = CARDS[h.cardId];
            return (
              <li key={h.peerId} className={h.peerId === room.peerId ? "is-me" : ""}>
                <strong>{h.name}</strong> · {c?.name}{" "}
                <span style={{ opacity: 0.55 }}>({c?.rarity})</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
