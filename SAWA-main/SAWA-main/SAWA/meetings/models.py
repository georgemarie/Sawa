from django.db import models
from django.db import models
import shortuuid
from accounts.models import User
from django.conf import settings
from datetime import datetime, timedelta, timezone


class Meeting(models.Model):
    creator = models.ForeignKey(User, on_delete=models.CASCADE) # The host
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    meeting_id = models.CharField(max_length=20, unique=True)   # The meeting link
    is_active = models.BooleanField(default=True)
    scheduled_date = models.DateField()
    meeting_time = models.TimeField()
    meeting_link = models.CharField(max_length=255)
    day = models.CharField(max_length=10, default='Saturday')
    is_started = models.BooleanField(default=False)

    def __str__(self):
        return self.title
    
    # used in dashboard
    def get_day(self):
        today = datetime.today().date()
        scheduled_date = self.scheduled_date
        
        if scheduled_date == today:
            return "Today"
        elif scheduled_date == today - timedelta(days=1):
            return "Yesterday"
        elif scheduled_date == today + timedelta(days=1):
            return "Tomorrow"
        elif scheduled_date >= today - timedelta(days=today.weekday()) and scheduled_date <= today + timedelta(days=(6 - today.weekday())):
            return self.day
        elif scheduled_date < today:
            return scheduled_date.strftime("%Y-%m-%d")
        else:
            return scheduled_date.strftime("%Y-%m-%d")


class MeetingParticipant(models.Model):
    meeting = models.ForeignKey(Meeting, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    is_host = models.BooleanField(default=False)

    class Meta:
        unique_together = ('meeting', 'user')


# Used in Script
class RoomMember(models.Model):
    name = models.CharField(max_length=200)
    uid = models.CharField(max_length=200)
    room_name = models.CharField(max_length=200)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.uid})"
