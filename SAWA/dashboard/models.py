from django.db import models
from accounts.models import User
from django.utils import timezone


class AnalyticsReport(models.Model):
    title = models.CharField(max_length=255)
    content = models.TextField()
    generated_at = models.DateTimeField(auto_now_add=True)


class SystemLogs(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='logs')
    action = models.TextField()
    timestamp = models.DateTimeField(default=timezone.now)

    def __str__(self):
        return f"{self.user.username} - {self.action} at {self.timestamp.strftime('%Y-%m-%d %H:%M:%S')}"