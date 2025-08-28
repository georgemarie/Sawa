# accounts/models.py

from django.db.models.signals import post_migrate
from django.dispatch import receiver
from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission
from django.conf import settings

# Language Options
class Language(models.TextChoices):
    ARABIC = 'AR', 'Arabic'
    ENGLISH = 'EN', 'English'
    # For now we are using 2 languages 


# Gender Options
class Gender(models.TextChoices):
    Male = "M", "Male"
    Female = "F", "Female"


# Modified User Class
class User(AbstractUser):
    id = models.IntegerField(primary_key=True, auto_created=True)
    first_name = models.CharField(max_length=30, null=True, blank=True)
    last_name = models.CharField(max_length=30, null=True, blank=True)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone_number = models.CharField(
        max_length=15, unique=True, null=True, blank=True)
    password = models.CharField(max_length=128, null=True, blank=True)
    guest = models.BooleanField(default=True)   # To Detect if user is guest.
    profile_picture = models.ImageField(
        upload_to='profile_pics/', null=True, blank=True)
    preferred_language = models.CharField(
        max_length=50, choices=Language.choices, default=Language.ARABIC)   # User Language will be used for dubbing
    gender = models.CharField(
        max_length=10, choices=Gender.choices, null=True, blank=True)
    voice_tone = models.ForeignKey(
        'VoiceTone', on_delete=models.SET_NULL, null=True, blank=True)  # Will be Used to use user voice.


class VoiceTone(models.Model):
    name = models.CharField(max_length=100)
    description = models.TextField()
    tone_file_path = models.CharField(max_length=255)


# Sets the rule of user for now => Admin or Normal User
class UserRole(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    role = models.ForeignKey('Role', on_delete=models.CASCADE)


class Role(models.Model):
    name = models.CharField(max_length=100)


class UserSettings(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='settings',
        help_text="The user these settings belong to."
    )

    # Meeting settings
    mute_microphone_on_join = models.BooleanField(
        default=False,
        help_text="Automatically mute the user's microphone when they join a meeting."
    )
    turn_off_video_on_join = models.BooleanField(
        default=False,
        help_text="Automatically turn off the user's video when they join a meeting."
    )

    # Translation settings
    enable_audio_translation = models.BooleanField(
        default=False,
        help_text="Enable automatic audio translation during meetings."
    )
    enable_caption_translation = models.BooleanField(
        default=False,
        help_text="Enable automatic translation of closed captions."
    )

    # Notification preferences
    receive_meeting_reminders = models.BooleanField(
        default=True,
        help_text="Receive a notification 10 minutes before a meeting starts."
    )

    def __str__(self):
        """
        Returns a string representation of the UserSettings instance.
        """
        return f"Settings for {self.user.username}"

    class Meta:
        verbose_name = "User Setting"
        verbose_name_plural = "User Settings"
