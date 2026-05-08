const { google } = require('googleapis');

function getCalendarClient() {

  console.log(
    "Google JSON exists:",
    !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );

  console.log(
    "Calendar ID exists:",
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

async function createCalendarEvent({
  summary,
  description,
  startDateTime,
  endDateTime,
}) {
  const calendar = getCalendarClient();

  const response = await calendar.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
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
}) {
  if (!eventId) return null;

  const calendar = getCalendarClient();

  const response = await calendar.events.update({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
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

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
};
