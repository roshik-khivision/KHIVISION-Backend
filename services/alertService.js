const Incident = require('../models/Incident');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { getAdmin } = require('./firebaseAdmin');

class AlertService {
  static async sendEmergencyAlerts(incidentId) {
    try {
      const incident = await Incident.findById(incidentId).populate('reportedBy');
      if (!incident) throw new Error('Incident not found');

      // Determine which departments to alert based on incident type
      const departmentsToAlert = this.getDepartmentsForIncident(incident.category);
      
      // Send alerts to relevant departments
      for (const department of departmentsToAlert) {
        await this.alertDepartment(department, incident);
      }

      // Send SMS alerts to emergency services
      await this.sendSMSAlerts(incident, departmentsToAlert);

      // Send push notifications
      await this.sendPushNotifications(incident);

      console.log(`Emergency alerts sent for incident: ${incidentId}`);
      
    } catch (error) {
      console.error('Error sending emergency alerts:', error);
      throw error;
    }
  }

  static getDepartmentsForIncident(category) {
    const departmentMapping = {
      'Accident': ['Rescue 1122', 'Traffic Police', 'Medical Emergency'],
      'Fire': ['Fire Brigade', 'Rescue 1122'],
      'Medical': ['Rescue 1122', 'Edhi Foundation', 'Chippa Ambulance', 'Medical Emergency'],
      'Crime': ['Traffic Police'],
      'Natural Disaster': ['Rescue 1122', 'Fire Brigade', 'Medical Emergency'],
      'Other': ['Rescue 1122']
    };

    return departmentMapping[category] || ['Rescue 1122'];
  }

  static async alertDepartment(department, incident) {
    try {
      // Find department users
      const departmentUsers = await User.find({
        role: { $in: ['department', 'admin', 'superadmin'] },
        department: department,
        status: 'active'
      });

      // Create notifications for department users
      const notifications = departmentUsers.map(user => ({
        recipient: user._id,
        title: `New ${incident.category} Incident`,
        message: `New ${incident.category} incident reported at ${incident.location.address}. Priority: ${incident.priority}`,
        type: 'incident_alert',
        relatedIncident: incident._id,
        priority: incident.priority
      }));

      await Notification.insertMany(notifications);

      // Emit real-time alert
      departmentUsers.forEach(user => {
        // This would be emitted via socket.io in the main server file
        console.log(`Real-time alert sent to department user: ${user.email}`);
      });

    } catch (error) {
      console.error(`Error alerting department ${department}:`, error);
    }
  }

  static async sendSMSAlerts(incident, departments) {
    // This is where you'd integrate with SMS gateway like Twilio
    const phoneNumbers = {
      'Edhi Foundation': process.env.EDHI_CONTACT,
      'Chippa Ambulance': process.env.CHIPPA_CONTACT,
      'Rescue 1122': process.env.RESCUE_1122_CONTACT
    };

    for (const department of departments) {
      const phoneNumber = phoneNumbers[department];
      if (phoneNumber) {
        // Implement SMS sending logic here
        console.log(`SMS alert sent to ${department}: ${phoneNumber}`);
        // await this.sendSMS(phoneNumber, this.createSMSMessage(incident));
      }
    }
  }

  static async sendPushNotifications(incident) {
    try {
      // Find users who should receive push notifications
      const usersToNotify = await User.find({
        role: { $in: ['admin', 'superadmin', 'department'] },
        status: 'active',
        $or: [
          { fcmToken: { $exists: true, $ne: null } },
          { fcmTokens: { $exists: true, $not: { $size: 0 } } }
        ]
      });

      console.log(`📱 Push Notifications: Found ${usersToNotify.length} admins/departments with FCM tokens`);

      for (const user of usersToNotify) {
        console.log(`🚀 Sending FCM push to ${user.email}`);
        // Send push notification using FCM
        await this.sendPushToUser(user, {
          title: `New ${incident.category} Incident`,
          body: `Incident reported at ${incident.location.address}`,
          data: {
            incidentId: incident._id.toString(),
            type: 'new_incident',
            priority: incident.priority
          }
        });
      }
    } catch (error) {
      console.error('Error sending push notifications:', error);
    }
  }

  static async sendPushToUser(user, payload) {
    if (!user) return;
    const tokens = new Set();
    if (user.fcmToken) tokens.add(user.fcmToken);
    if (Array.isArray(user.fcmTokens)) {
      user.fcmTokens.forEach(t => { if (t) tokens.add(t); });
    }
    
    for (const token of tokens) {
      await this.sendFCMPush(token, payload);
    }
  }

  static async sendFCMPush(fcmToken, payload) {
    if (!fcmToken) return;

    const admin = getAdmin();
    if (!admin) {
      // Firebase Admin not configured yet — log and skip silently
      console.warn('⚠️  FCM push skipped (Firebase Admin not initialized). Configure firebase-service-account.json or FIREBASE_SERVICE_ACCOUNT_BASE64 env var.');
      return;
    }

    try {
      // Stringify all data values (FCM requires string values in data map)
      const stringData = {};
      if (payload.data) {
        for (const [k, v] of Object.entries(payload.data)) {
          stringData[k] = String(v);
        }
      }

      const message = {
        token: fcmToken,
        notification: {
          title: payload.title,
          body:  payload.body,
        },
        data: stringData,
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'khivision_alerts',
          },
        },
        apns: {
          payload: {
            aps: { sound: 'default', badge: 1 },
          },
        },
        webpush: {
          notification: {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ FCM push sent successfully: ${response}`);
    } catch (err) {
      if (err.code === 'messaging/registration-token-not-registered') {
        // Token is stale — clear it from the user record
        console.warn(`🗑️  Stale FCM token detected, removing: ${fcmToken.substring(0, 20)}...`);
        await User.updateMany({ fcmTokens: fcmToken }, { $pull: { fcmTokens: fcmToken } });
        await User.updateMany({ fcmToken: fcmToken }, { $unset: { fcmToken: 1 } });
      } else {
        console.error('❌ FCM push error:', err.message);
      }
    }
  }

  static createSMSMessage(incident) {
    return `EMERGENCY ALERT: ${incident.category} incident at ${incident.location.address}. Coordinates: ${incident.location.coordinates[1]}, ${incident.location.coordinates[0]}. Priority: ${incident.priority}. Please respond immediately.`;
  }

  static async notifyDriverAssignment(incidentId, driverId) {
    try {
      const incident = await Incident.findById(incidentId);
      const driver = await User.findById(driverId);

      // Create notification
      await Notification.create({
        recipient: driverId,
        title: 'New Assignment',
        message: `You have been assigned to incident #${incident._id} at ${incident.location.address}`,
        type: 'assignment',
        relatedIncident: incidentId,
        priority: 'high'
      });

      // Send push notification to driver
      if (driver.fcmToken || (driver.fcmTokens && driver.fcmTokens.length > 0)) {
        await this.sendPushToUser(driver, {
          title: 'New Assignment',
          body: `You have been assigned to an incident at ${incident.location.address}`,
          data: {
            incidentId: incident._id.toString(),
            type: 'driver_assignment'
          }
        });
      }

      console.log(`Assignment notification sent to driver: ${driver.phone}`);

    } catch (error) {
      console.error('Error notifying driver:', error);
    }
  }

  static async notifyIncidentStatusUpdate(incidentId, newStatus, performedBy) {
    try {
      const incident = await Incident.findById(incidentId).populate('reportedBy').populate('assignedTo.driver');
      
      let title = '';
      let message = '';

      switch (newStatus) {
        case 'approved':
          title = 'Incident Approved';
          message = `Your incident #${incidentId} has been approved and is being processed.`;
          break;
        case 'rejected':
          title = 'Incident Rejected';
          message = `Your incident #${incidentId} has been rejected.`;
          break;
        case 'completed':
          title = 'Incident Completed';
          message = `Incident #${incidentId} has been marked as completed.`;
          break;
        default:
          title = 'Incident Status Updated';
          message = `Incident #${incidentId} status has been updated to ${newStatus}.`;
      }

      // Notify reporter
      if (incident.reportedBy) {
        await Notification.create({
          recipient: incident.reportedBy._id,
          title,
          message,
          type: 'status_update',
          relatedIncident: incidentId
        });
        
        // Send push notification to reporter
        if (incident.reportedBy.fcmToken || (incident.reportedBy.fcmTokens && incident.reportedBy.fcmTokens.length > 0)) {
          await this.sendPushToUser(incident.reportedBy, {
            title,
            body: message,
            data: {
              incidentId: incident._id.toString(),
              type: 'status_update'
            }
          });
        }
      }

      // Notify assigned driver if any
      if (incident.assignedTo && incident.assignedTo.driver) {
        await Notification.create({
          recipient: incident.assignedTo.driver._id,
          title: 'Incident Status Updated',
          message: `Incident #${incidentId} status updated to ${newStatus}`,
          type: 'status_update',
          relatedIncident: incidentId
        });
        
        // Send push notification to driver
        if (incident.assignedTo.driver.fcmToken || (incident.assignedTo.driver.fcmTokens && incident.assignedTo.driver.fcmTokens.length > 0)) {
          await this.sendPushToUser(incident.assignedTo.driver, {
            title: 'Incident Status Updated',
            body: `Incident #${incidentId} status updated to ${newStatus}`,
            data: {
              incidentId: incident._id.toString(),
              type: 'status_update'
            }
          });
        }
      }

    } catch (error) {
      console.error('Error notifying status update:', error);
    }
  }
}

module.exports = AlertService;