import { learnTrains, type TrainHit } from './lookup';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "Anand Vihar Terminal (ANVT)" -> "ANVT" */
const codeOf = (text: string | null | undefined) => /\(([A-Z0-9]{2,5})\)\s*$/.exec((text ?? '').trim())?.[1] ?? '';

/** Read the trains currently shown on IRCTC's train list. */
export function readTrainCards(): TrainHit[] {
  const hits: TrainHit[] = [];
  for (const card of document.querySelectorAll('app-train-avl-enq')) {
    const number = card.querySelector('.train-number')?.textContent?.trim() ?? '';
    const name = card.querySelector('.train-name')?.textContent?.trim() ?? '';
    if (!/^\d{5}$/.test(number) || !name) continue;
    const stops = card.querySelectorAll('.journey-stop .stop-city');
    const days = Array.from(card.querySelectorAll('.week-days .week-day'))
      .map((d, i) => (d.classList.contains('week-day--active') ? DAYS[i] : ''))
      .filter((d): d is string => !!d);
    hits.push({
      number,
      name,
      from: codeOf(stops[0]?.textContent),
      to: codeOf(stops[stops.length - 1]?.textContent),
      type: '',
      days,
    });
  }
  return hits;
}

/** The booked train shown on the passenger / review / payment pages ("PPTA FESTIVL SPL (04096)"). */
export function readJourneyTrain(): TrainHit | null {
  const el = document.querySelector<HTMLElement>('app-journey-details');
  if (!el) return null;
  const lines = el.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
  let number = '';
  let name = '';
  for (const l of lines) {
    const m = /^(.+?)\s*\((\d{5})\)$/.exec(l);
    if (m) {
      name = m[1]!.trim();
      number = m[2]!;
      break;
    }
  }
  if (!number || !name) return null;
  const codes = lines.map((l) => /\(([A-Z]{2,5})\)$/.exec(l)?.[1]).filter((c): c is string => !!c);
  return { number, name, from: codes[0] ?? '', to: codes[1] ?? '', type: '', days: [] };
}

/**
 * Remember trains seen on IRCTC's own pages (the train list, and the booked train on the passenger,
 * review and payment pages). They feed the Journey form's suggestions later, with no API call.
 */
export function startHarvest(setTimer: (fn: () => void, ms: number) => unknown): void {
  let lastList = '';
  let lastTrain = '';
  const run = () => {
    const path = location.pathname;
    if (path.includes('/booking/train-list')) {
      const hits = readTrainCards();
      const signature = hits.map((h) => h.number).join(',');
      if (!hits.length || signature === lastList) return;
      lastList = signature;
      void learnTrains(hits).catch(() => undefined);
    } else if (/\/(booking\/(psgninput|reviewBooking)|payment\/)/.test(path)) {
      const t = readJourneyTrain();
      if (!t || t.number === lastTrain) return;
      lastTrain = t.number;
      void learnTrains([t]).catch(() => undefined);
    }
  };
  setTimer(run, 2000);
}
