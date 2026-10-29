// Shared rendering of a consultation's details, used by both the mentor
// portal (js/mentor.js) and the admin subscriber drawer (js/admin.js).

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

// Returns HTML lines (joined with <br>) for everything recorded in `c`.
export function consultationDetailsHtml(c) {
  const p = c.profile || {};
  const lines = [];

  const basics = [
    p.age ? `${p.age} yrs` : '',
    p.gender || '',
    p.height ? `${p.height} cm` : '',
    has(c.weight) ? `${c.weight} kg` : '',
  ].filter(Boolean);
  if (basics.length) lines.push(escapeHtml(basics.join(' · ')));
  const bmi = computeBmi(Number(p.height), Number(c.weight));
  if (bmi) lines.push(line('BMI', bmi));

  if (p.comorbidities) lines.push(line('Co-morbidities', p.comorbidities));
  if (Array.isArray(p.medications) && p.medications.length) lines.push(line('Medication', p.medications.join('; ')));
  if (p.surgeryHistory === 'yes') lines.push(line('Surgery history', p.surgeryDetails || 'Yes'));
  if (p.allergies) lines.push(line('Allergies', p.allergies));

  const habits = [];
  if (p.habits?.alcohol) habits.push('Alcohol');
  if (p.habits?.smoking) habits.push('Smoking');
  if (p.habits?.other) habits.push(p.habits.other);
  if (habits.length) lines.push(line('Habits', habits.join(', ')));
  if (p.foodBeliefs) lines.push(line('Food beliefs', p.foodBeliefs));

  if (c.healthNotes) lines.push(line('Health notes', c.healthNotes));
  if (c.dietAdvice) lines.push(line('Diet advice', c.dietAdvice));
  if (c.nextFollowUp) lines.push(`<strong>Next follow-up:</strong> ${formatShortDate(c.nextFollowUp)}`);

  return lines.join('<br>') || 'No details.';
}
