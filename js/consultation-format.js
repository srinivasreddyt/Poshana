// Shared consultation helpers, used by both the mentor portal (js/mentor.js)
// and the admin subscriber drawer (js/admin.js).
//
// A client's health profile is recorded once, on their first consultation
// (stored as that consultation's `profile`). Later consultations only hold
// visit details: weight, health notes, diet advice, next follow-up.

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

export function formatShortDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function computeBmi(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

function has(value) {
  return value !== undefined && value !== null && value !== '';
}

function line(label, value) {
  return `<strong>${label}:</strong> ${escapeHtml(String(value))}`;
}

// The consultation holding the client's profile: the earliest one that has
// a profile. `consultations` are one client's consultations, any order.
export function findProfileSource(consultations) {
  return consultations
    .filter((c) => c.profile)
    .sort((a, b) => (toDate(a.date)?.getTime() || 0) - (toDate(b.date)?.getTime() || 0))[0] || null;
}

export function profileHtml(p) {
  if (!p) return '';
  const lines = [];
  if (p.name) lines.push(line('Name', p.name));
  const basics = [p.age ? `${p.age} yrs` : '', p.gender || '', p.height ? `${p.height} cm` : ''].filter(Boolean);
  if (basics.length) lines.push(escapeHtml(basics.join(' · ')));
  lines.push(line('Co-morbidities', p.comorbidities || 'None'));
  lines.push(line('Medication', Array.isArray(p.medications) && p.medications.length ? p.medications.join('; ') : 'None'));
  lines.push(line('Surgery history', p.surgeryHistory === 'yes' ? (p.surgeryDetails || 'Yes') : 'No'));
  lines.push(line('Allergies', p.allergies || 'None'));
  const habits = [];
  if (p.habits?.alcohol) habits.push('Alcohol');
  if (p.habits?.smoking) habits.push('Smoking');
  if (p.habits?.other) habits.push(p.habits.other);
  lines.push(line('Habits', habits.length ? habits.join(', ') : 'None'));
  if (p.foodBeliefs) lines.push(line('Food beliefs', p.foodBeliefs));
  return lines.join('<br>');
}

// Visit-specific details. heightCm comes from the client's profile so BMI
// can be shown for every visit's weight.
export function visitDetailsHtml(c, heightCm) {
  const lines = [];
  if (has(c.weight)) {
    const bmi = computeBmi(Number(heightCm), Number(c.weight));
    lines.push(line('Weight', `${c.weight} kg${bmi ? ` (BMI ${bmi})` : ''}`));
  }
  if (c.healthNotes) lines.push(line('Health notes', c.healthNotes));
  if (c.dietAdvice) lines.push(line('Diet advice', c.dietAdvice));
  if (c.nextFollowUp) lines.push(`<strong>Next follow-up:</strong> ${formatShortDate(c.nextFollowUp)}`);
  return lines.join('<br>') || 'No details.';
}
