from langdetect import detect
from openai import OpenAI
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from .models import *
from accounts.models import *
from django.utils.timezone import now
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from datetime import datetime
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
import json
from datetime import datetime, time as time_obj
from django.shortcuts import render, redirect
from django.http import JsonResponse
from .models import Meeting, MeetingParticipant, RoomMember
import shortuuid
from django.utils import timezone
from agora_token_builder import RtcTokenBuilder
import time
import os
from django.views.decorators.csrf import csrf_exempt
from django.core.files.storage import default_storage
from elevenlabs.client import ElevenLabs
from io import BytesIO
from django.core.files.base import ContentFile
import threading
import os
import re
from dashboard.models import *
from google.cloud import speech
import requests

ElevenLabsKey = "sk_542e2a4e4b2bdeac06c1a0c2c228b61e05881164a489abe1"
DeepgramKey = "2ff61f1a8420b52f0bacc2f1e0b8af30fc0c2012"
client = OpenAI(api_key="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")


# <-------------------------------Meetings Management------------------------------->#

# Create Meeting and log it
@login_required
def create_meeting(request):
    if request.method == 'POST':
        title = request.POST.get('title')
        description = request.POST.get('description', '')
        meeting_time = request.POST.get('meeting_time')
        scheduled_date = request.POST.get('scheduled_date')

        scheduled_date_obj = datetime.strptime(
            scheduled_date, '%Y-%m-%d').date()
        scheduled_day = scheduled_date_obj.strftime('%A')

        now = datetime.now()
        meeting_datetime = datetime.combine(
            scheduled_date_obj, datetime.strptime(meeting_time, '%H:%M').time())

        if meeting_datetime < now:
            messages.error(
                request, 'The meeting cannot be scheduled in the past.')
            return redirect('dashboard_home')

        meeting = Meeting.objects.create(
            creator=request.user,
            title=title,
            description=description,
            meeting_id=shortuuid.ShortUUID().random(length=10),
            scheduled_date=scheduled_date_obj,
            meeting_time=meeting_time,
            day=scheduled_day
        )

        MeetingParticipant.objects.create(
            meeting=meeting,
            user=request.user,
            is_host=True
        )

        SystemLogs.objects.create(
            user=request.user,
            action=f"Created Meeting {meeting.title}"
        )

        messages.success(request, 'Meeting created successfully!')

    return redirect('dashboard_home')

####################################################################################

# Send Meeting Details to Ajax


@login_required
def meeting_detail(request, meeting_id):
    try:
        meeting = get_object_or_404(
            Meeting,
            id=meeting_id,
            # creator=request.user
        )

        meeting_data = {
            'id': meeting.id,
            'title': meeting.title,
            'link': meeting.meeting_id,
            'date': meeting.scheduled_date.strftime('%Y-%m-%d'),
            'time': meeting.meeting_time.strftime('%H:%M'),
            'description': meeting.description or '',
            'is_creator': request.user == meeting.creator,
        }

        return JsonResponse(meeting_data)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=404)

####################################################################################

# Update Meeting through ajax "only for host"


@login_required
@require_http_methods(["POST"])
def update_meeting(request, meeting_id):
    try:
        data = json.loads(request.body)
        meeting = get_object_or_404(
            Meeting, id=meeting_id, creator=request.user)

        meeting.title = data.get('title', meeting.title)
        meeting.description = data.get('description', meeting.description)

        meeting_date = data.get('scheduled_date')
        meeting_time = data.get('meeting_time')

        if meeting_date and meeting_time:
            try:
                scheduled_date_obj = datetime.strptime(
                    meeting_date, '%Y-%m-%d').date()
                meeting_time_obj = datetime.strptime(
                    meeting_time, '%H:%M').time()

                # Validate datetime
                combined = datetime.combine(
                    scheduled_date_obj, meeting_time_obj)
                if combined < datetime.now():
                    return JsonResponse({'error': 'Meeting cannot be scheduled in the past'}, status=400)

                # Update model
                meeting.scheduled_date = scheduled_date_obj
                meeting.meeting_time = meeting_time_obj
                meeting.day = scheduled_date_obj.strftime('%A')

            except ValueError as e:
                return JsonResponse({'error': f'Invalid date/time format: {str(e)}'}, status=400)

        meeting.save()
        SystemLogs.objects.create(
            user=request.user,
            action=f"Updated Meeting : {meeting.title}"
        )
        return JsonResponse({'status': 'success'})

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)

####################################################################################

# Remove Meeting for participant and Delete Meeting for host


@login_required
@require_http_methods(["POST"])
def delete_meeting(request, meeting_id):
    try:
        meeting = get_object_or_404(
            Meeting, id=meeting_id)
        if request.user != meeting.creator:
            MeetingParticipant.objects.get(
                meeting=meeting, user=request.user).delete()
            SystemLogs.objects.create(
                user=request.user,
                action=f"Removed Meeting : {meeting.title}"
            )
        else:
            meeting.delete()
            SystemLogs.objects.create(
                user=request.user,
                action=f"Deleted Meeting : {meeting.title}"
            )
        return JsonResponse({'status': 'success'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=400)

# <----------------------------End of Meetings Management--------------------------->#


# <-----------------------------------Room Management------------------------------->#

####################################################################################

# Enter Meeting Room
# @login_required
def join_meeting(request, meeting_id):
    if not request.user.is_authenticated:
        email = "guest" + str(User.objects.last().id+1)
        user = User.objects.create(
            username=email,
            first_name="guest" + str(User.objects.last().id+1),
            last_name="",
            email=email,
            phone_number=User.objects.last().id+1,
            password="guest",
            gender=None,
            guest=True,
        )

        normal_user_role = Role.objects.get(name="normal user")
        user = User.objects.get(email=email)
        UserRole.objects.create(user=user, role=normal_user_role)

        login(request, user)
    try:
        meeting = Meeting.objects.get(meeting_id=meeting_id)
    except Meeting.DoesNotExist:
        messages.error(request, 'Meeting not found.')
        return redirect('dashboard_home')

    if request.user == meeting.creator:
        meeting.is_started = True
        meeting.save()

    if not meeting.is_started:
        return redirect("waiting_room", meeting_id=meeting_id)

    # Check if user is already a participant
    participant, created = MeetingParticipant.objects.get_or_create(
        meeting=meeting,
        user=request.user,
        defaults={'joined_at': timezone.now()}
    )

    if not created:
        participant.joined_at = timezone.now()
        participant.save()

    SystemLogs.objects.create(
        user=request.user,
        action=f"Joined Meeting : {meeting.title}"
    )

    # Set session data for Agora
    request.session['room'] = meeting_id
    request.session['room_name'] = meeting.title
    request.session['email'] = request.user.username
    request.session['name'] = request.user.first_name + \
        " " + request.user.last_name
    request.session['UID'] = str(request.user.id)

    context = {
        'meeting': meeting,
        'user': request.user,
        'participant': participant,
        'room': meeting_id,
        'room_name': meeting.title,
        'name': request.user.first_name + " " + request.user.last_name,
        'email': request.user.username,
        'uid': str(request.user.id),
        'user': request.user
    }

    return render(request, 'meetings/room.html', context)

####################################################################################

# Just to log user leaving


@login_required
def leave_meeting(request, meeting_id):
    print("leave meeting called")
    try:
        meeting = Meeting.objects.get(meeting_id=meeting_id)
    except Meeting.DoesNotExist:
        messages.error(request, 'Meeting not found.')
        return redirect('dashboard_home')

    participant, created = MeetingParticipant.objects.get_or_create(
        meeting=meeting,
        user=request.user,
        defaults={'left_at': timezone.now()}
    )
    participant.left_at = timezone.now()
    participant.save()
    SystemLogs.objects.create(
        user=request.user,
        action=f"Left Meeting : {meeting.title}"
    )
    return redirect("dashboard_home")

####################################################################################

# Create Instant Meeting


@login_required
def join_instant_meeting(request):
    meeting_id = shortuuid.ShortUUID().random(length=10)
    today = timezone.now().strftime('%A')
    last_meeting = Meeting.objects.last()
    next_id = (last_meeting.id + 1) if last_meeting else 1

    Meeting.objects.create(
        creator=request.user,
        title="Instant Meeting " + str(next_id),
        description="Instant Meeting",
        meeting_id=meeting_id,
        scheduled_date=timezone.now().date(),
        meeting_time=timezone.now().time(),
        day=today
    )
    return redirect('join_meeting', meeting_id=meeting_id)

####################################################################################

# Join meeting through join meeting button


def join_meeting_outer(request):
    if request.method == 'POST':
        try:
            meeting_link_id = request.POST.get('meeting_id')
            messages.error(request, "Meeting not found")
            # check if it's link or meeting_id
            match = re.search(r'/meetings/join/(\w+)/?', meeting_link_id)
            meeting_id = match.group(1) if match else meeting_link_id
            return redirect("join_meeting", meeting_id=meeting_id)
        except:
            return redirect("dashboard_home")
    return redirect("dashboard_home")


####################################################################################

# Waiting Room when host didn't start meeting
@login_required
def waiting_room(request, meeting_id):
    try:
        meeting = Meeting.objects.get(meeting_id=meeting_id)

        participant, created = MeetingParticipant.objects.get_or_create(
            meeting=meeting,
            user=request.user,
            defaults={'joined_at': timezone.now()}
        )

        context = {
            'meeting': meeting,
            'user': request.user,
            'participant': participant if request.user.is_authenticated else None,
            'meeting_id': meeting_id
        }

        return render(request, 'meetings/waiting_room.html', context)

    except Meeting.DoesNotExist:
        messages.error(request, 'Meeting not found.')
        return redirect('dashboard_home')

####################################################################################

# If meeting_id doesn't exist


def meeting_not_found(request):
    messages.error(
        request, 'Meeting not found or you do not have permission to join.')
    return redirect('dashboard_home')

####################################################################################

# Generate different channels for different meetings


@login_required
def get_token(request):
    try:
        appId = "2f3d920faaa7487ebf90616924df5b59"
        appCertificate = "aab84d2c12fd4c23aa00b4c4cdf98606"
        channelName = request.GET.get('channel')
        uid = request.GET.get('uid')

        print(f"Token Request - Channel: {channelName}, UID: {uid}")

        if not all([appId, appCertificate, channelName, uid]):
            missing = []
            if not appId:
                missing.append('appId')
            if not appCertificate:
                missing.append('appCertificate')
            if not channelName:
                missing.append('channelName')
            if not uid:
                missing.append('uid')

            return JsonResponse({
                'error': 'Missing required parameters',
                'missing': missing
            }, status=400)

        # Convert uid to integer as required by Agora
        try:
            int_uid = int(uid)
        except ValueError:
            print(f"Invalid UID format: {uid}")
            int_uid = 0  # Use 0 for string userIds

        expireTimeInSeconds = 3600
        currentTimestamp = int(time.time())
        privilegeExpiredTs = currentTimestamp + expireTimeInSeconds

        print(
            f"Generating token with params - AppID: {appId[:8]}..., Channel: {channelName}, UID: {int_uid}")

        try:
            from agora_token_builder.RtcTokenBuilder import RtcTokenBuilder, Role_Publisher
            token = RtcTokenBuilder.buildTokenWithUid(
                appId,
                appCertificate,
                channelName,
                int_uid,
                Role_Publisher,
                privilegeExpiredTs
            )

            print(f"Token generated successfully - Length: {len(token)}")
            # Only print first 20 chars for security
            print(f"Token preview: {token[:20]}...")

        except Exception as token_error:
            print(f"Token generation error: {str(token_error)}")
            print(
                f"Parameters used: AppID length: {len(appId)}, Certificate length: {len(appCertificate)}")
            import traceback
            print(f"Full traceback: {traceback.format_exc()}")
            return JsonResponse({
                'error': 'Token generation failed',
                'details': str(token_error)
            }, status=500)

        if not token:
            print("Token generation failed - empty token returned")
            return JsonResponse({
                'error': 'Failed to generate token - token is empty'
            }, status=500)

        response_data = {
            'token': token,
            'uid': int_uid,
            'channel': channelName,
            'expires_in': expireTimeInSeconds
        }
        print(f"Returning response with token length: {len(token)}")
        return JsonResponse(response_data)

    except Exception as e:
        import traceback
        print(f"Error generating token: {str(e)}")
        print(traceback.format_exc())
        return JsonResponse({
            'error': 'Token generation failed',
            'message': str(e),
            'traceback': traceback.format_exc()
        }, status=500)

####################################################################################

# Member Joined Room


@login_required
def create_member(request):
    data = json.loads(request.body)
    member, created = RoomMember.objects.get_or_create(
        name=data['name'],
        uid=data['UID'],
        room_name=data['room_name'],
    )
    return JsonResponse({'name': data['name']}, safe=False)

####################################################################################

# Fetch Member Details


@login_required
def get_member(request):
    uid = request.GET.get('UID')
    room_name = request.GET.get('room_name')

    member = RoomMember.objects.get(
        uid=uid,
        room_name=room_name,
    )
    name = member.name

    try:
        user = User.objects.get(id=uid)
        profile_picture = user.profile_picture.url if user.profile_picture else None
        gender = user.gender if user.gender else "M"
    except User.DoesNotExist:
        profile_picture = None
        gender = "M"

    return JsonResponse({
        'name': name,
        'profile_picture': profile_picture,
        'gender': gender,
    })

####################################################################################

# Member left meeting


@login_required
def delete_member(request):
    data = json.loads(request.body)
    member = RoomMember.objects.get(
        name=data['name'],
        uid=data['UID'],
        room_name=data['room_name']
    )

    # Check if the leaving user is the host (meeting creator)
    try:
        meeting = Meeting.objects.get(meeting_id=data['room_name'])
        if meeting.creator.username == data['name']:
            # Host is leaving - end the meeting for everyone
            meeting.is_started = False
            meeting.save()

            # Remove all room members (temporary meeting participants)
            RoomMember.objects.filter(room_name=data['room_name']).delete()

            return JsonResponse({
                'status': 'host_left',
                'message': 'Host ended the meeting'
            }, safe=False)
    except Meeting.DoesNotExist:
        pass

    # Regular member leaving
    member.delete()
    return JsonResponse('Member deleted', safe=False)

####################################################################################


@login_required
def host_leave_meeting(request):
    """Endpoint for host to explicitly end the meeting"""
    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            room_name = data.get('room_name')

            meeting = Meeting.objects.get(meeting_id=room_name)

            # Verify the user is the host
            if meeting.creator != request.user:
                return JsonResponse({'error': 'Only the host can end the meeting'}, status=403)

            # End the meeting
            meeting.is_started = False
            meeting.save()

            # Remove all room members (temporary meeting participants)
            RoomMember.objects.filter(room_name=room_name).delete()

            return JsonResponse({
                'status': 'success',
                'message': 'Meeting ended successfully'
            })

        except Meeting.DoesNotExist:
            return JsonResponse({'error': 'Meeting not found'}, status=404)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

    return JsonResponse({'error': 'Invalid request method'}, status=405)

####################################################################################


@login_required
def check_meeting_status(request, meeting_id):
    """Check if meeting is still active"""
    try:
        meeting = Meeting.objects.get(meeting_id=meeting_id)
        return JsonResponse({
            'is_started': meeting.is_started,
            'meeting_id': meeting.meeting_id
        })
    except Meeting.DoesNotExist:
        return JsonResponse({'error': 'Meeting not found'}, status=404)


# <----------------------------End of Room Management------------------------------->#


# <--------------------------Translation and Audio Processing----------------------->#

# Main Translation Function
@csrf_exempt
def translate_audio(request):
    # log the action
    SystemLogs.objects.create(
        user=request.user,
        action="Started Dubbing"
    )

    # Get the audio file
    if request.method == "POST" and request.FILES.get("audio"):
        audio_file = request.FILES["audio"]
        mode = request.POST.get("mode", "fast")  # Default to fast mode
        user_gender = request.POST.get("user_gender", "M")  # Default to Male
        user_id = request.POST.get("uid", "unknown")
        room_id = request.POST.get("room", "unknown")

        # Default to current user language
        target_language = request.POST.get(
            "target_language", request.user.preferred_language.lower)
        target_language = target_language.lower()

        # Tracing the process in terminal "for local"
        print(f"=== TRANSLATE AUDIO REQUEST ===")
        print(f"User ID: {user_id}, Room: {room_id}")
        print(
            f"Received audio file: {audio_file.name}, size: {audio_file.size} bytes")
        print(
            f"Mode: {mode}, Gender: {user_gender}, Language:{target_language}")

        # Skip processing if file is too small (likely silence)
        if audio_file.size < 1000:  # Less than 1KB
            print("Skipping small audio file (likely silence)")
            return JsonResponse({"error": "Audio too small"}, status=400)

        # Save the uploaded file
        path = default_storage.save("temp_audio.webm", audio_file)
        full_path = default_storage.path(path)
        print(f"Saved file size: {os.path.getsize(full_path)} bytes")

        try:
            # Convert file to readable stream
            with open(full_path, "rb") as f:
                audio_data = BytesIO(f.read())
                audio_data.name = "audio.webm"

            print(
                f"Audio file processed - size: {len(audio_data.getvalue())} bytes")

            # Check audio format and content
            audio_bytes = audio_data.getvalue()
            print(f"Audio bytes length: {len(audio_bytes)}")
            print(f"First 100 bytes: {audio_bytes[:100]}")

            # Check if it's a valid WebM file
            if audio_bytes.startswith(b'\x1a\x45\xdf\xa3'):
                print("Valid WebM file detected")
            else:
                print("Warning: File doesn't appear to be a valid WebM file")

            # Choose translation method based on mode
            if mode == "accurate":
                return try_accurate_dubbing(audio_data, full_path, target_language)
            else:
                return try_faster_translation(audio_data, full_path, user_gender, target_language)

        except Exception as e:
            import traceback
            print("ERROR in translate_audio:", traceback.format_exc())
            print(f"Error details: {str(e)}")
            # Clean up the temporary file on error
            try:
                default_storage.delete(path)
            except:
                pass
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)

####################################################################################

# Direct Dubbing "Won't be used High Latency "


def try_accurate_dubbing(audio_data, full_path, target):
    """Accurate dubbing approach using ElevenLabs dubbing API with Arabic to English translation"""
    try:
        elevenlabs = ElevenLabs(api_key=ElevenLabsKey)
        # source language
        if target == 'en':
            source_lang = "ar"
        else:
            source_lang = 'en'

        target_lang = target  # target language

        print(f"Creating accurate dubbing: Arabic -> English")
        print(
            f"Source language: {source_lang}, Target language: {target_lang}")

        # Step 1: Create dubbing with explicit language detection
        try:
            dubbed = elevenlabs.dubbing.create(
                file=audio_data,
                target_lang=target_lang,
                source_lang=source_lang  # Explicitly specify Arabic as source
            )
            print(f"Dubbing created with ID: {dubbed.dubbing_id}")
        except Exception as dubbing_create_error:
            print(f"Dubbing creation failed: {dubbing_create_error}")
            # Try without explicit source language (let API auto-detect)
            try:
                dubbed = elevenlabs.dubbing.create(
                    file=audio_data,
                    target_lang=target_lang
                )
                print(
                    f"Dubbing created with auto-detection: {dubbed.dubbing_id}")
            except Exception as auto_detect_error:
                print(
                    f"Auto-detection dubbing also failed: {auto_detect_error}")
                return try_faster_translation(audio_data, full_path, "M", target)

        # Step 2: Wait for dubbing to complete with timeout
        print("Waiting for dubbing to complete...")
        max_wait_time = 40  # Maximum 20 seconds wait
        wait_count = 0

        while wait_count < max_wait_time:
            try:
                status = elevenlabs.dubbing.get(dubbed.dubbing_id).status
                print(f"Dubbing status: {status}")

                if status == "dubbed":
                    break
                elif status == "failed":
                    print("Dubbing failed, creating fallback response")
                    return try_faster_translation(audio_data, full_path, "M", target)
                elif status == "processing":
                    print("Dubbing still processing...")
                else:
                    print(f"Unknown dubbing status: {status}")

            except Exception as status_error:
                print(f"Error checking dubbing status: {status_error}")
                # Continue waiting despite status check error

            time.sleep(1)  # Check every second
            wait_count += 1

        if wait_count >= max_wait_time:
            print("Dubbing timeout, creating fallback response")
            return try_faster_translation(audio_data, full_path, "M", target)

        print("Dubbing completed, getting audio...")

        # Step 3: Get dubbed audio
        try:
            dubbed_audio_generator = elevenlabs.dubbing.audio.get(
                dubbed.dubbing_id, target_lang)

            # Save the dubbed audio to a temporary file
            dubbed_audio_bytes = b"".join(dubbed_audio_generator)
            print(f"Dubbed audio size: {len(dubbed_audio_bytes)} bytes")

            # Only save if we got meaningful audio
            if len(dubbed_audio_bytes) < 1000:
                print("Dubbed audio too small, creating fallback response")
                return try_faster_translation(audio_data, full_path, "M", target)

            # Save the dubbed audio
            dubbed_path = default_storage.save(
                f"dubbed_audio_{dubbed.dubbing_id}.mp3", ContentFile(dubbed_audio_bytes))
            dubbed_url = default_storage.url(dubbed_path)
            print(f"Dubbed audio saved to: {dubbed_url}")

            # Clean up the original temporary file
            try:
                default_storage.delete(full_path)
            except Exception as cleanup_error:
                print(f"Error cleaning up original file: {cleanup_error}")

            # Schedule cleanup of dubbed file after 2 minutes
            def cleanup_dubbed_file():
                time.sleep(120)  # 2 minutes
                try:
                    default_storage.delete(dubbed_path)
                    print(f"Cleaned up dubbed file: {dubbed_path}")
                except Exception as cleanup_error:
                    print(f"Error cleaning up dubbed file: {cleanup_error}")

            cleanup_thread = threading.Thread(target=cleanup_dubbed_file)
            cleanup_thread.daemon = True
            cleanup_thread.start()

            return JsonResponse({"dubbed_audio_url": dubbed_url})

        except Exception as audio_error:
            print(f"Error getting dubbed audio: {audio_error}")
            return try_faster_translation(audio_data, full_path, "M", target)

    except Exception as e:
        print(f"Accurate dubbing failed: {e}")
        return try_faster_translation(audio_data, full_path, "M", target)

####################################################################################

# #################GSTT#################

def convert_google_stt(audio_data, target_language):
    print("Starting speech-to-text conversion using Google Cloud...")
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = r"E:\Programming\FCAI - Assignments & Projects\SAWA_Git\SAWA\static\assets\planar-unity-464615-n4-b097ec558de7.json"
    print(f"Audio data type: {type(audio_data)}")
    print(f"Audio data size: {len(audio_data.getvalue()) if hasattr(audio_data, 'getvalue') else 'unknown'}")

    transcript = None

    # Reset and read audio bytes
    audio_data.seek(0)
    content = audio_data.read()

    client = speech.SpeechClient()
    audio = speech.RecognitionAudio(content=content)

    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
        language_code="ar-EG" if target_language == 'EN' else 'en-US' ,
        audio_channel_count=2,
    )

    response = client.recognize(config=config, audio=audio)

    for result in response.results:
        if result.alternatives and len(result.alternatives[0].transcript.strip()) > 2:
            transcript = result.alternatives[0].transcript.strip()
            print("Successfully transcribed using Google STT")
            break

    print(f"Transcribed text: {transcript}")
    return transcript


############ Eleven Labs STT#############
def convert_eleven_labs_stt(elevenlabs, audio_data, target):
            print("Starting speech-to-text conversion using eleven laps...")
            print(f"Audio data type: {type(audio_data)}")
            print(
                f"Audio data size: {len(audio_data.getvalue()) if hasattr(audio_data, 'getvalue') else 'unknown'}")

            transcript = None
            models_to_try = ["scribe_v1", "scribe_v1_experimental"]

            for model_id in models_to_try:
                try:
                    print(f"Trying STT model: {model_id}")
                    transcript = elevenlabs.speech_to_text.convert(
                        file=audio_data,
                        model_id=model_id
                    )
                    if transcript and transcript.text and len(transcript.text.strip()) > 2:
                        print(f"Successfully used model: {model_id}")
                        break
                    else:
                        print(
                            f"Model {model_id} returned empty or short text")
                except Exception as model_error:
                    print(f"Model {model_id} failed: {model_error}")
                    continue

            if not transcript or not transcript.text:
                raise Exception("All STT models failed")

            if len(transcript.text.strip()) < 2:
                raise Exception("Transcribed text too short")

            print(f"Transcribed text: {transcript.text}")
            transcript = transcript.text
            return transcript

# The core dubbing function STT -> Translation -> TTS



def try_faster_translation(audio_data, original_path, user_gender, target):
    """Faster translation approach using STT + TTS"""
    try:
        print("Attempting faster translation approach using STT + TTS...")

        elevenlabs = ElevenLabs(api_key=ElevenLabsKey)

        try:
            print("Testing ElevenLabs API connection...")
            print("ElevenLabs API initialized successfully")
        except Exception as api_error:
            print(f"API initialization warning: {api_error}")

        # 1. STT
        if target == 'EN    ':
            transcript = ""
            try:
                try:
                    transcript = convert_google_stt(audio_data, target)
                except Exception as e:
                    print (f"GSTT Error {e}")
                    transcript = convert_eleven_labs_stt(elevenlabs, audio_data, target)
                translated_text = None
                    # If Stt_Step failed
            except Exception as stt_error:
                print(f"STT + TTS approach failed: {stt_error}")
                import traceback
                print(traceback.format_exc())
        else:
            try:
                try:
                    transcript = convert_eleven_labs_stt(elevenlabs, audio_data, target)
                except Exception as e:
                    print (f"Eleven Labs Error {e}")
                    transcript = convert_google_stt(audio_data, target)
                translated_text = None
                    # If Stt_Step failed
            except Exception as stt_error:
                print(f"STT + TTS approach failed: {stt_error}")
                import traceback
                print(traceback.format_exc())

# ------------------------------------------------------------------------------------------------------------------------------------------------------------------

        # 2.Translation

        # Try OpenAI translation
        if target == "ar":
            # English to Arabic
            prompt = "You are a professional English to Arabic translator. ( please just translate the text to arabic even it's not english don't stop translating and don't talk to much just translate the text provided)"
            user_prompt = f"translate this and return the translated text only: {transcript}"
        else:
            # Arabic to English (default)
            prompt = "You are a professional Arabic to English translator. ( please just translate the text to english even it's not arabic don't stop translating and don't talk to much just translate the text provided)"
            user_prompt = f"translate this and return the translated text only: {transcript}"
        try:
            response = client.chat.completions.create(
                model="gpt-4",
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.2
            )
            translated_text = response.choices[0].message.content.strip()
            print(f"OpenAI translation successful: {translated_text}")
        except Exception as openai_error:
            print(f"OpenAI translation failed: {openai_error}")
            try:
                print("Attempting Google Translate API...")
                # Google Translate API
                url = "https://translate.googleapis.com/translate_a/single"
                params = {
                    'client': 'gtx',
                    'sl': 'ar',  # Arabic
                    'tl': 'en',  # English
                    'dt': 't',
                    'q': transcript
                }

                response = requests.get(url, params=params, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if data and len(data) > 0 and len(data[0]) > 0:
                        translated_text = data[0][0][0]
                        print(
                            f"Google translation successful: {translated_text}")
                    else:
                        print("Google translation returned empty result")
                else:
                    print(
                        f"Google translation failed with status: {response.status_code}")

            except Exception as google_error:
                print(f"Google translation failed: {google_error}")

# ------------------------------------------------------------------------------------------------------------------------------------------------------------------

        # 3. TTS Using ElevenLabs

        # Fallback to transcript text if translation not good
        if not translated_text or len(translated_text.strip()) < 2:
            translated_text = transcript

        # Choose voice
        if target == "ar":
            # Use Arabic voice (female/male)
            voice_id = "QRq5hPRAKf5ZhSlTBH6r" if user_gender == "M" else "meAbY2VpJkt1q46qk56T"
        else:
            # Use English voice (female/male)
            voice_id = "0yXkuUWXDHdmdQJugJLb" if user_gender == "M" else "21m00Tcm4TlvDq8ikWAM"

        audio_generator = elevenlabs.text_to_speech.convert(
            text=translated_text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2"
        )

        audio_bytes = b"".join(audio_generator)
        if len(audio_bytes) < 1000:
            raise Exception("Generated audio too small")

        audio_path = default_storage.save(
            f"tts_audio_{int(time.time())}.mp3", ContentFile(audio_bytes))
        audio_url = default_storage.url(audio_path)

        default_storage.delete(original_path)

        def cleanup():
            time.sleep(120)
            try:
                default_storage.delete(audio_path)
            except:
                pass

        threading.Thread(target=cleanup, daemon=True).start()

        return JsonResponse({"dubbed_audio_url": audio_url})


    except Exception as e:
        print(f"Faster translation failed: {e}")
        import traceback
        print(traceback.format_exc())
        return JsonResponse({"error": "Translation failed"}, status=500)


#################################################################################


from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
import time
import threading
import os
from io import BytesIO


# --- Helper function for STT (reusing your existing logic) ---
def _perform_stt(audio_data):
    """Performs Speech-to-Text using Google Cloud as primary and ElevenLabs as fallback."""
    transcript = None
    try:
        print("Attempting STT with Google Cloud...")
        transcript = convert_google_stt(audio_data, 'EN') # Assuming target lang doesn't matter for STT source
        if transcript:
            return transcript
    except Exception as e:
        print(f"Google STT failed: {e}. Falling back to ElevenLabs.")
        try:
            elevenlabs = ElevenLabs(api_key=ElevenLabsKey)
            transcript = convert_eleven_labs_stt(elevenlabs, audio_data, 'EN')
            if transcript:
                return transcript
        except Exception as el_e:
            print(f"ElevenLabs STT also failed: {el_e}")
    
    return transcript


# --- Helper function for Translation ---
def _perform_translation(text, target_language):
    """Translates text using OpenAI as primary and Google Translate as fallback."""
    if not text:
        return None

    # Determine prompt based on target language
    if target_language == "ar":
        prompt = "You are a professional English to Arabic translator. Translate the following text concisely."
    else:
        prompt = "You are a professional Arabic to English translator. Translate the following text concisely."

    # Try OpenAI first
    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.2
        )
        translated_text = response.choices[0].message.content.strip()
        print(f"OpenAI translation successful: {translated_text}")
        return translated_text
    except Exception as openai_error:
        print(f"OpenAI translation failed: {openai_error}. Falling back to Google Translate.")
        # Fallback to Google Translate can be added here if desired
        return None


# <--- NEW VIEW FOR CAPTIONS --->
@csrf_exempt
def generate_caption(request):
    if request.method != 'POST' or not request.FILES.get('audio'):
        return JsonResponse({'error': 'Invalid request'}, status=400)

    audio_file = request.FILES['audio']
    should_translate = request.POST.get('translate', 'false').lower() == 'true'
    target_language = request.user.preferred_language.lower() if request.user.is_authenticated else 'en'

    if audio_file.size < 1000:
        return JsonResponse({'status': 'skipped', 'reason': 'Audio too small'}, status=200)

    try:
        audio_data = BytesIO(audio_file.read())
        audio_data.name = "audio.webm"
        
        # 1. Perform Speech-to-Text
        transcript = _perform_stt(audio_data)
        if not transcript:
            return JsonResponse({'error': 'STT failed'}, status=500)

        final_text = transcript
        
        # 2. Perform Translation if requested
        if should_translate:
            translated_text = _perform_translation(transcript, target_language)
            if translated_text:
                final_text = translated_text

        return JsonResponse({'caption_text': final_text})

    except Exception as e:
        print(f"Error in generate_caption: {e}")
        return JsonResponse({'error': str(e)}, status=500)
# <-----------------------End ofTranslation and Audio Processing-------------------->#
