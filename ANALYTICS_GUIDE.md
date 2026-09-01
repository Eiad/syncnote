# Firebase Analytics Testing Guide for SyncNote

## Overview
This guide will help you test and monitor Firebase Analytics events in your SyncNote app. We've implemented comprehensive event tracking across all major user interactions.

## Setup Requirements

### 1. Firebase Console Setup
- Ensure your Firebase project has Analytics enabled
- Verify your app is properly connected to Firebase
- Make sure you have the correct Firebase configuration in your environment variables

### 2. Environment Variables
Ensure these are set in your `.env.local`:
```
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## Testing Events in Firebase Console

### 1. Real-time Testing with DebugView
1. **Open Firebase Console** → Project → Analytics
2. **Navigate to DebugView** (in the left sidebar)
3. **Start your app** and perform actions
4. **Watch events appear in real-time** in the DebugView

### 2. Events Dashboard
1. **Go to Analytics → Events** in Firebase Console
2. **View all triggered events** with their parameters
3. **Click on any event** to see detailed parameters

## Event Categories and Testing

### 🔐 Authentication Events

#### Login Events
- **`login_attempted`** - Triggered when user attempts to login
  - Parameters: `login_method`, `user_email`
  - Test: Try logging in with email/password or Google

- **`login_success`** - Successful login
  - Parameters: `login_method`, `user_email`, `user_id`, `user_display_name`
  - Test: Successfully log in

- **`login_failed`** - Failed login attempt
  - Parameters: `login_method`, `error_type`, `error_code`, `user_email`
  - Test: Try logging in with wrong credentials

#### Signup Events
- **`signup_attempted`** - User attempts to signup
  - Parameters: `user_email`, `user_name`
  - Test: Try creating a new account

- **`signup_success`** - Successful signup
  - Parameters: `user_email`, `user_name`, `user_id`, `signup_method`
  - Test: Successfully create an account

- **`signup_failed`** - Failed signup attempt
  - Parameters: `error_type`, `error_code`, `user_email`, `user_name`
  - Test: Try signing up with existing email

#### Other Auth Events
- **`password_reset_requested`** - Password reset requested
- **`password_reset_email_sent`** - Reset email sent successfully
- **`password_reset_error`** - Password reset error
- **`user_logout`** - User logout
- **`logout_error`** - Logout error

### 📊 Dashboard Events

#### Navigation Events
- **`dashboard_accessed`** - User accessed dashboard
  - Parameters: `user_id`, `user_email`, `user_display_name`
  - Test: Log in and access dashboard

- **`tab_switched`** - User switched between tabs
  - Parameters: `from_tab`, `to_tab`, `user_id`
  - Test: Switch between Media Share and File Share tabs

- **`login_mode_changed`** - Login mode changed
  - Parameters: `from_mode`, `to_mode`
  - Test: Switch between "Ash Only" and "Email Login" modes

### 📝 Text Operations Events

#### Text Saving Events
- **`text_saved`** - Text saved (manual or keyboard)
  - Parameters: `document_id`, `user_id`, `text_length`, `save_method`
  - Test: Save text using Save button or Cmd/Ctrl + Enter

- **`text_cleared`** - Text cleared
  - Parameters: `document_id`, `user_id`, `text_length_before`
  - Test: Click Clear button

- **`text_edited`** - Significant text changes (every 100 characters)
  - Parameters: `document_id`, `user_id`, `text_length`, `change_milestone`
  - Test: Type more than 100 characters

#### Text Error Events
- **`text_load_error`** - Error loading text
- **`text_save_error`** - Error saving text

### 🖼️ Media Operations Events

#### Upload Events
- **`media_upload_success`** - Media uploaded successfully
  - Parameters: `user_id`, `document_id`, `file_size`, `file_format`, `total_images`, `upload_method`
  - Test: Upload an image using the upload widget

- **`media_upload_error`** - Media upload error
  - Parameters: `error_message`, `user_id`, `document_id`
  - Test: Try uploading an unsupported file type

#### Paste Events
- **`media_paste_upload_started`** - Paste upload started
- **`media_paste_upload_success`** - Paste upload success
- **`media_paste_upload_error`** - Paste upload error
- **`media_drop_upload_started`** - Drag-and-drop upload started
- **`media_drop_upload_success`** - Drag-and-drop upload success
- **`media_drop_upload_error`** - Drag-and-drop upload error
  - Test: Copy an image and paste it (Ctrl/Cmd + V)

#### Delete Events
- **`media_delete_all_started`** - Delete all started
- **`media_delete_all_success`** - Delete all success
- **`media_delete_all_error`** - Delete all error
  - Test: Click "Clear" button to delete all images

#### View Events
- **`media_image_viewed`** - Image viewed
  - Parameters: `user_id`, `document_id`, `image_index`, `total_images`
  - Test: Click on an image to view it

#### Widget Events
- **`media_upload_widget_opened`** - Upload widget opened
- **`media_loaded`** - Media loaded
  - Test: Navigate to Media Share tab

## Step-by-Step Testing Process

### 1. Initial Setup
```bash
# Start your development server
npm run dev
```

### 2. Open Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select Project
3. Navigate to Analytics → DebugView

### 3. Test Authentication Flow
1. **Open your app** and go to login page
2. **Try logging in** with wrong credentials (should trigger `login_failed`)
3. **Log in successfully** (should trigger `login_success`)
4. **Log out** (should trigger `user_logout`)

### 4. Test Dashboard Interactions
1. **Access dashboard** (should trigger `dashboard_accessed`)
2. **Switch tabs** (should trigger `tab_switched`)
3. **Use text features** (should trigger text events)

### 5. Test Text Operations
1. **Type in text area** (should trigger `text_edited` at milestones)
2. **Save text** (should trigger `text_saved`)
3. **Clear text** (should trigger `text_cleared`)

### 6. Test Media Operations
1. **Upload an image** (should trigger `media_upload_success`)
2. **Paste an image** (should trigger paste events)
3. **View an image** (should trigger `media_image_viewed`)
4. **Delete all images** (should trigger delete events)

## Analytics Dashboard in App

For the "Ash" user, there's a floating Analytics button in the bottom-right corner that shows:
- All available events
- Event categories
- Testing instructions

## Common Issues and Solutions

### Events Not Appearing
1. **Check Firebase configuration** - Ensure all environment variables are set
2. **Verify Analytics is enabled** - Check Firebase Console → Analytics
3. **Check browser console** - Look for any Firebase errors
4. **Wait for propagation** - Events can take a few minutes to appear

### DebugView Not Working
1. **Use Chrome extension** - Install Firebase Analytics Debugger
2. **Check network** - Ensure no ad blockers are interfering
3. **Verify project** - Make sure you're in the correct Firebase project

### Event Parameters Missing
1. **Check user authentication** - Some events require user to be logged in
2. **Verify user context** - Ensure user object is available
3. **Check optional chaining** - Some parameters might be undefined

## Best Practices

### 1. Event Naming
- Use descriptive, consistent names
- Follow snake_case convention
- Group related events with prefixes

### 2. Parameters
- Include relevant context (user_id, document_id)
- Add error information for failed events
- Include method/type information

### 3. Testing
- Test both success and failure scenarios
- Verify all parameters are being sent
- Check real-time and historical data

## Next Steps

1. **Monitor Events** - Watch for patterns in user behavior
2. **Set up Conversions** - Mark important events as conversions
3. **Create Audiences** - Segment users based on behavior
4. **Set up Alerts** - Get notified of unusual activity
5. **Analyze Trends** - Use the data to improve your app

## Support

If you encounter issues:
1. Check the browser console for errors
2. Verify Firebase configuration
3. Test with DebugView first
4. Check Firebase Console → Analytics → Events

Happy testing! 🚀 