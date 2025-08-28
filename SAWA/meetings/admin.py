from django.contrib import admin
from .models import *


admin.site.register(Meeting)
admin.site.register(MeetingParticipant)
admin.site.register(RoomMember)
