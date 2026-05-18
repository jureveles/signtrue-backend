const { google } = require('googleapis');

function getCalendarClient() {

  console.log(
    "Google JSON exists:",
    !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  console.log(
    "Default Calendar ID exists:",
    !!process.env.GOOGLE_CALENDAR_ID
  );

  const credentials = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  return google.calendar({ version: 'v3', auth });
}

// Helper: use school calendar first, otherwise fallback to Render env calendar
function resolveCalendarId(calendarId) {
  return calendarId || process.env.GOOGLE_CALENDAR_ID;
}

async function createCalendarEvent({
  summary,
  description,
  startDateTime,
  endDateTime,
  calendarId,
}) {
  const calendar = getCalendarClient();

  const response = await calendar.events.insert({
    calendarId: resolveCalendarId(calendarId),
    requestBody: {
      summary,
      description,
      start: {
        dateTime: startDateTime,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'America/New_York',
      },
    },
  });

  return response.data;
}

async function updateCalendarEvent({
  eventId,
  summary,
  description,
  startDateTime,
  endDateTime,
  calendarId,
}) {
  if (!eventId) return null;

  const calendar = getCalendarClient();

  const response = await calendar.events.update({
    calendarId: resolveCalendarId(calendarId),
    eventId,
    requestBody: {
      summary,
      description,
      start: {
        dateTime: startDateTime,
        timeZone: 'America/New_York',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'America/New_York',
      },
    },
  });

  return response.data;
}

async function deleteCalendarEvent({
  eventId,
  calendarId,
}) {
  if (!eventId) return null;

  const calendar = getCalendarClient();

  await calendar.events.delete({
    calendarId: resolveCalendarId(calendarId),
    eventId,
  });

  return true;
}

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
};
