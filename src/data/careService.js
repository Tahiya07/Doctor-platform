import { doctors, facilities, specialties, initialAppointments, initialConversations, initialMessages } from './mockData.js';

/** Async-shaped mock boundary: components depend on these methods, not fixture imports. */
const pause = () => new Promise((resolve) => window.setTimeout(resolve, 180));
let appointments = [...initialAppointments];
let conversations = [...initialConversations];
let messages = structuredClone(initialMessages);
let doctorsState = [...doctors];
let facilitiesState = [...facilities];
let specialtiesState = [...specialties];

export const careService = {
  async listDoctors(filters = {}) {
    await pause();
    return doctorsState.filter((doctor) => (!filters.specialty || doctor.specialtyId === filters.specialty) && (!filters.location || doctor.location.toLowerCase().includes(filters.location.toLowerCase())) && (!filters.verified || doctor.verified) && (!filters.language || doctor.languages.includes(filters.language)) && (!filters.available || doctor.availability.some((day) => day.toLowerCase().includes(filters.available.toLowerCase()))) && (!filters.maxFee || doctor.fee <= Number(filters.maxFee)) && (!filters.query || `${doctor.name} ${doctor.specialty} ${doctor.location}`.toLowerCase().includes(filters.query.toLowerCase())));
  },
  async getDoctor(id) { await pause(); return doctorsState.find((item) => item.id === id) ?? null; },
  async listFacilities(kind = 'all') { await pause(); return kind === 'all' ? [...facilitiesState] : facilitiesState.filter((item) => item.type === kind); },
  async listSpecialties() { await pause(); return [...specialtiesState]; },
  async listAppointments() { await pause(); return [...appointments]; },
  async submitAppointment(payload) { await pause(); const item = { ...payload, id: `a${Date.now()}`, status: 'confirmed' }; appointments = [item, ...appointments]; return item; },
  async listConversations() { await pause(); return [...conversations]; },
  async listMessages(conversationId) { await pause(); return [...(messages[conversationId] ?? [])]; },
  async sendMessage(conversationId, body) { await pause(); const message = { id: `m${Date.now()}`, conversationId, sender: 'patient', body, sentAt: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) }; messages[conversationId] = [...(messages[conversationId] ?? []), message]; return message; },
  async updateDoctorStatus(id, status) { await pause(); const verificationStatus = status === 'approved' ? 'verified' : status; doctorsState = doctorsState.map((doctor) => doctor.id === id ? { ...doctor, verified: verificationStatus === 'verified', verificationStatus } : doctor); return doctorsState.find((doctor) => doctor.id === id); },
  async addDoctor(input) { await pause(); const doctor = { ...input, id: `d${Date.now()}`, verified: false, verificationStatus: 'pending', rating: 0, reviewCount: 0, facilityIds: [], availability: ['This week'], nextAvailable: 'To be scheduled' }; doctorsState = [doctor, ...doctorsState]; return doctor; },
  async addFacility(input) { await pause(); const facility = { ...input, id: `f${Date.now()}`, distanceKm: 0, image: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=900&q=80' }; facilitiesState = [facility, ...facilitiesState]; return facility; },
  async updateFacility(id, input) { await pause(); facilitiesState = facilitiesState.map((facility) => facility.id === id ? { ...facility, ...input } : facility); return facilitiesState.find((facility) => facility.id === id); },
  async addSpecialty(input) { await pause(); const specialty = { ...input, id: input.slug }; specialtiesState = [...specialtiesState, specialty]; return specialty; },
};
