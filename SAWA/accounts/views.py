import os
import re
import random
from .models import *
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth import authenticate, login, logout
import json
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.contrib.auth.hashers import check_password
from django.contrib.auth import update_session_auth_hash
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.core.mail import send_mail
from dashboard.models import *
from meetings.models import *

egyptian_phone_pattern = r"^01[0125][0-9]{8}$"


############## Registration & Login Views #############

# Register New Users & Handling OTP
def register(request):
    # If User is already active return to dashboard.
    if request.user.is_active:
        messages.info(request, "You are already logged in.")
        return redirect('landing_home')
    
    if request.method == 'POST':
        # Get form data
        first_name = request.POST.get('first_name')
        last_name = request.POST.get('last_name')
        email = request.POST.get('email')
        phone_number = request.POST.get('phone_number')
        password = request.POST.get('password')
        confirm_password = request.POST.get('confirm_password')
        gender = request.POST.get('gender')
        # Language set to default --> Arabic

        # Validate
        if len(password) < 8:
            return JsonResponse({'success': False, 'error': "Password must be at least 8 characters long."})
        if password != confirm_password:
            # messages.error(request, 'Passwords do not match!')
            return JsonResponse({'success': False, 'error': "Passwords do not match!"})
        if User.objects.filter(email=email).exists():
            # messages.error(request, 'Email is already registered!')
            return JsonResponse({'success': False, 'error': "Email is already registered!"})
        
        if not re.match(egyptian_phone_pattern, phone_number):
            return JsonResponse({'success': False, 'error' : "Please enter valid number!"})
        if User.objects.filter(phone_number=phone_number).exists():
            # messages.error(request, 'This number is already registered!')
            return JsonResponse({'success': False, 'error': "This number is already registered!"})

        # Save data in session
        request.session['pending_user'] = {
            'first_name': first_name,
            'last_name': last_name,
            'email': email,
            'phone_number': phone_number,
            'password': password,
            'gender': gender,
        }

        # Generate and send OTP
        otp = generate_otp()
        request.session['otp'] = otp
        request.session['otp_email'] = email

        send_mail(
            subject='Your OTP Code',
            message=f"Your OTP code is: {otp}. Please keep it and don't share it to anyone else.",
            from_email="sawa2025.cu@gmail.com",
            recipient_list=[email],
            fail_silently=False,
        )

        # print(otp)

        return JsonResponse({'success': True, 'message': 'OTP sent to your email.'})

    return render(request, 'Login & Sign up/signup.html')


# Verify OTP & Complete Registration
@csrf_exempt
def verify_otp(request):
    if request.method == 'POST':
        otp_input = request.POST.get('otp')
        otp_session = request.session.get('otp')
        pending_user = request.session.get('pending_user')

        if not pending_user:
            return JsonResponse({'success': False, 'error': 'No pending registration found.'})

        if otp_input == otp_session:
            # Create user
            User.objects.create_user(
                username=pending_user['email'],
                first_name=pending_user['first_name'],
                last_name=pending_user['last_name'],
                email=pending_user['email'],
                phone_number=pending_user['phone_number'],
                password=pending_user['password'],
                gender=pending_user['gender'],
                guest=False,
            )
            normal_user_role = Role.objects.get(name="normal user")
            user = User.objects.get(username = pending_user['email'])
            UserRole.objects.create(user=user, role=normal_user_role)

            # Clean up session
            del request.session['pending_user']
            del request.session['otp']
            del request.session['otp_email']

            messages.success(request, 'Registration successful! Please log in')
            return JsonResponse({'success': True, 'message': 'Registration complete!'})
        else:
            return JsonResponse({'success': False, 'error': 'Invalid OTP.'})

    return JsonResponse({'success': False, 'error': 'Invalid request method.'}, status=405)


# Logging Normal User and Admin in.
def user_login(request):
    # If User is already active return to dashboard.
    if request.user.is_active:
        messages.info(request, "You are already logged in.")
        return redirect('landing_home')

    # Get User Credentials
    if request.method == 'POST':
        email = request.POST.get('email')
        password = request.POST.get('password')

        # Authenticate User.
        user = authenticate(request, username=email, password=password)
        
        if user is not None:
            login(request, user)
            
            messages.success(request, "Login successful!")

            # Detect User Type after Login
            user_role = ""
            try:
                user_role = UserRole.objects.get(user = user)
            except Exception as e:
                messages.warning(request, e)
            if user_role.role.name == 'admin':
                return redirect('admin_dashboard')
            
            return redirect('dashboard_home')
        else:
            messages.error(request, "Invalid email or password!")
            return redirect('login')

    return render(request, 'Login & Sign up/login.html')


# Logout Function
@login_required
def user_logout(request):
    logout(request)
    messages.success(request, "You have been logged out.")
    return redirect('landing_home')


# Forget Password.
@csrf_exempt
def forget_password(request):
    if request.method == "POST":
        step = request.POST.get('step')
        email = request.POST.get('email')
        otp_input = request.POST.get('otp')
        new_password = request.POST.get('new_password')
        confirm_password = request.POST.get('confirm_password')

        # Step 1: Send OTP
        if step == "send_otp":
            if not email or not User.objects.filter(email=email).exists():
                return JsonResponse({'success': False, 'error': "Email not found."})
            otp = generate_otp()
            request.session['reset_email'] = email
            request.session['reset_otp'] = otp
            send_mail(
                subject='Your Password Reset OTP',
                message=f"Your OTP code is: {otp}. Please keep it and don't share it to anyone else.",
                from_email="sawa2025.cu@gmail.com",
                recipient_list=[email],
                fail_silently=False,
            )
            return JsonResponse({'success': True, 'message': "OTP sent to your email."})

        # Step 2: Verify OTP
        elif step == "verify_otp":
            if otp_input == request.session.get('reset_otp'):
                request.session['otp_verified'] = True
                return JsonResponse({'success': True, 'message': "OTP verified."})
            else:
                return JsonResponse({'success': False, 'error': "Invalid OTP."})

        # Step 3: Set new password
        elif step == "set_password":
            if not request.session.get('otp_verified'):
                return JsonResponse({'success': False, 'error': "OTP not verified."})
            if new_password != confirm_password:
                return JsonResponse({'success': False, 'error': "Passwords do not match."})
            if len(new_password) < 8:
                return JsonResponse({'success': False, 'error': "Password must be at least 8 characters."})
            try:
                user = User.objects.get(email=request.session.get('reset_email'))
                user.set_password(new_password)
                user.save()
                # Clean up session
                for key in ['reset_email', 'reset_otp', 'otp_verified']:
                    if key in request.session:
                        del request.session[key]
                return JsonResponse({'success': True, 'message': "Password reset successful. Please log in."})
            except User.DoesNotExist:
                return JsonResponse({'success': False, 'error': "User not found."})

        return JsonResponse({'success': False, 'error': "Invalid step."})

    return render(request, 'Login & Sign up/login.html')


# To generate random OTP
def generate_otp():
    return str(random.randint(100000, 999999))


# Send OTP to the user.
def send_otp(request):
    if request.method == 'POST': 
        email = request.POST.get('email')
        if not email:
            return JsonResponse({'success': False, 'error': "Invalid Email Provided"}, status=400)
        
        otp = generate_otp()

        request.session['otp'] = otp
        request.session['otp_email'] = email

        send_mail(
            subject='Your OTP Code',
            message=f"Your OTP code is: {otp}. Please keep it and don't share it to anyone else.",
            from_email="sawa2025.cu@gmail.com",
            recipient_list=[email],
            fail_silently=False,
        )
        return JsonResponse({'success': True, 'message':'OTP sent to your email.'})
    
    return JsonResponse({'success': False, 'error': 'Invalid request method.'}, status=405)    


############# Profile View #############

#View Profile Data and Update it also.
@login_required
def profile_view(request):
    user = request.user
    # A checker to logout if the user is guest. "guest is allowed to join meeting only"
    if user.guest : 
        return redirect ("logout")
    
    # Fetch User Data
    if request.method == 'POST':
        first_name = request.POST.get('first_name', user.first_name)
        last_name = request.POST.get('last_name', user.last_name)
        # email = request.POST.get('email', user.email)
        phone_number = request.POST.get('phone_number', user.phone_number)
        gender = request.POST.get('gender', user.gender)
        preferred_language = request.POST.get(
            'preferred_language', user.preferred_language)
        profile_picture = request.FILES.get(
            'profile_picture', user.profile_picture)

        # Validate when updating
        # if User.objects.filter(email=email).exclude(id=user.id).exists():
            # messages.error(request, "Email is already registered!")
            # return redirect('profile')
        
        if not re.match(egyptian_phone_pattern, phone_number):
            messages.error(request, "Please enter valid number!")
            return redirect('profile')
        
        if User.objects.filter(phone_number=phone_number).exclude(id=user.id).exists():
            messages.error(request, "This number is already registered!")
            return redirect('profile')

        # Update after validation
        user.first_name = first_name
        user.last_name = last_name
        # user.email = email
        user.phone_number = phone_number
        user.gender = gender
        user.preferred_language = preferred_language
        profile_picture = request.FILES.get('profile_picture')

        if profile_picture:
            # Delete the old profile picture if it exists
            if user.profile_picture and os.path.isfile(user.profile_picture.path):
                os.remove(user.profile_picture.path)

            # Save the new profile picture
            user.profile_picture = profile_picture

        user.save()

        SystemLogs.objects.create(
            user=user,
            action="Updated his profile"
        )

        messages.success(
            request, 'Your profile has been updated successfully!')
        return redirect('profile')

    return render(request, 'Profile & Settings/profile.html', {'user': user, 'Language': Language, 'Gender': Gender})


# For updating password
@login_required
def update_password(request):
    # Get Data
    if request.method == 'POST':
        current_password = request.POST.get('current_password')
        new_password1 = request.POST.get('new_password1')
        new_password2 = request.POST.get('new_password2')
        user = request.user

        # Validate Data
        if not check_password(current_password, user.password):
            messages.error(request, "Current password is incorrect.")
            return redirect('profile')

        if new_password1 != new_password2:
            messages.error(request, "New passwords do not match.")
            return redirect('profile')

        if len(new_password1) < 8:
            messages.error(
                request, "New password must be at least 8 characters long.")
            return redirect('profile')

        # Update password after validation
        user.set_password(new_password1)
        user.save()

        SystemLogs.objects.create(
            user=user,
            action="Changed his password"
        )
        update_session_auth_hash(request, user)
        messages.success(request, "Password updated successfully.")
        return redirect('profile')

    return render(request, 'profile.html')


# Updating and Deleting Profile Image

@login_required
@require_POST
def update_profile_image(request):
    user = request.user
    profile_picture = request.FILES.get('profile_picture')

    if profile_picture:
        # Remove old picture if exists
        if user.profile_picture and os.path.isfile(user.profile_picture.path):
            os.remove(user.profile_picture.path)

        # Save new profile picture
        user.profile_picture = profile_picture
        user.save()

        SystemLogs.objects.create(
            user=user,
            action="Updated his profile Pic"
        )
        return redirect('profile')

    return JsonResponse({'success': False, 'error': 'No image uploaded'})


@login_required
@require_POST
def delete_profile_image(request):
    user = request.user
    try:
        if user.profile_picture and os.path.isfile(user.profile_picture.path):
            os.remove(user.profile_picture.path)
        user.profile_picture = None
        user.save()

        SystemLogs.objects.create(
            user=user,
            action="Removed his profile pic"
        )
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})


############# Settings View #############

# endpoint for meeting room when dubbing is on and when video is off.
@login_required
def get_user_gender(request, user_id):
    try:
        user = User.objects.get(id=user_id)
        return JsonResponse({
            'gender': user.gender or 'M',
            'user_id': user_id
        })
    except User.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST 
def update_settings_view(request):

    try:
        data = json.loads(request.body)
        setting_name = data.get('setting_name')
        setting_value = data.get('setting_value')

        allowed_settings = [
            'mute_microphone_on_join',
            'turn_off_video_on_join',
            'enable_audio_translation',
            'enable_caption_translation',
            'receive_meeting_reminders',
        ]

        if setting_name in allowed_settings:
            settings = UserSettings.objects.get(user=request.user)
            setattr(settings, setting_name, setting_value)
            settings.save()
            return JsonResponse({'status': 'success', 'message': f'{setting_name} updated.'})
        else:
            return JsonResponse({'status': 'error', 'message': 'Invalid setting name.'}, status=400)

    except (UserSettings.DoesNotExist, json.JSONDecodeError):
        return JsonResponse({'status': 'error', 'message': 'Bad request or user settings not found.'}, status=400)


@login_required
def settings_view(request):
    settings, created = UserSettings.objects.get_or_create(user=request.user)
    hosted_meetings = Meeting.objects.filter(creator=request.user).count()
    joined_meetings = MeetingParticipant.objects.filter(user=request.user).count()

    context = {
        "settings": settings,
        "hosted_meetings": hosted_meetings,
        "joined_meetings": joined_meetings
    }
    return render(request, 'Profile & Settings/settings.html', context)


# endpoint for meeting room to get mute and video status
@login_required
def get_user_settings(request, user_id):
        user = User.objects.get(id=user_id)
        settings, created = UserSettings.objects.get_or_create(user=user)
        try:
            user = User.objects.get(id=user_id)
            return JsonResponse({
                'mic': settings.mute_microphone_on_join,
                'video': settings.turn_off_video_on_join,
                'translated_captions': settings.enable_caption_translation,
                'user_id': user_id
            })
        except User.DoesNotExist:
            return JsonResponse({'error': 'User not found'}, status=404)
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)