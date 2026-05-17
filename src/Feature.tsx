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
type TradeOffer = { from: string; to: string; ts: number };

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
    const t = room.doc.getArray<TradeOffer>("offers");
    const cb = () => rerender((n) => n + 1);
    h.observe(cb);
    t.observe(cb);
    return () => {
      h.unobserve(cb);
      t.unobserve(cb);
    };
  }, [room]);

  const holdings = room.doc.getMap<Holding>("holdings");
  const offers = room.doc.getArray<TradeOffer>("offers");

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

  const proposeTrade = (otherId: string) => {
    if (!my || otherId === room.peerId) return;
    if (!holdings.has(otherId)) return;
    // dedupe outgoing offer
    if (offers.toArray().some((o) => o.from === room.peerId && o.to === otherId)) return;
    offers.push([{ from: room.peerId, to: otherId, ts: Date.now() }]);
  };

  const accept = (from: string) => {
    if (!my) return;
    const theirHolding = holdings.get(from);
    if (!theirHolding) return;
    room.doc.transact(() => {
      // swap
      holdings.set(from, { ...theirHolding, cardId: my.cardId });
      holdings.set(room.peerId, { ...my, cardId: theirHolding.cardId });
      // remove their offer to me + any reverse offer
      const arr = offers.toArray();
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]!;
        if ((o.from === from && o.to === room.peerId) || (o.from === room.peerId && o.to === from))
          offers.delete(i, 1);
      }
    });
  };

  const decline = (from: string) => {
    const arr = offers.toArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      const o = arr[i]!;
      if (o.from === from && o.to === room.peerId) offers.delete(i, 1);
    }
  };

  const myPayload = makeScanPayload(room.roomId, room.peerId, name.trim() || "anon");

  const inbound = offers.toArray().filter((o) => o.to === room.peerId);
  const outbound = offers.toArray().filter((o) => o.from === room.peerId);

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
        showLabel="your QR — show to propose a trade"
        scanLabel="scan to propose a trade"
        onScan={(parsed) => proposeTrade(parsed.peerId)}
      />

      <section>
        <h2 className="viral-section-title">offers to you ({inbound.length})</h2>
        {inbound.length === 0 ? (
          <p className="viral-empty">none</p>
        ) : (
          <ul className="tc-offers">
            {inbound.map((o) => {
              const them = holdings.get(o.from);
              const theirCard = them ? CARDS[them.cardId] : null;
              return (
                <li key={o.from}>
                  <strong>{them?.name ?? "?"}</strong> offers their <em>{theirCard?.name}</em>{" "}
                  <button type="button" className="viral-primary" onClick={() => accept(o.from)}>
                    accept
                  </button>{" "}
                  <button type="button" className="viral-ghost" onClick={() => decline(o.from)}>
                    decline
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outbound.length > 0 && (
        <section>
          <h2 className="viral-section-title">your pending offers</h2>
          <ul className="viral-tags">
            {outbound.map((o) => (
              <li key={o.to}>→ {holdings.get(o.to)?.name ?? o.to.slice(0, 6)}</li>
            ))}
          </ul>
        </section>
      )}

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
