-- Persistent Music.app monitor. Prints one JSON object per line on stderr via `log`.
-- Keep this process alive only while Folia clients are connected.

on jsonEscape(inputText)
	set s to inputText as text
	set s to my replaceText(s, "\\", "\\\\")
	set s to my replaceText(s, "\"", "\\\"")
	set s to my replaceText(s, return, "\\n")
	set s to my replaceText(s, linefeed, "\\n")
	set s to my replaceText(s, tab, "\\t")
	return s
end jsonEscape

on replaceText(theText, searchString, replacementString)
	set AppleScript's text item delimiters to searchString
	set theItems to text items of theText
	set AppleScript's text item delimiters to replacementString
	set theText to theItems as text
	set AppleScript's text item delimiters to ""
	return theText
end replaceText

on snapshotJson()
	tell application "System Events"
		set musicRunning to (name of processes) contains "Music"
	end tell
	if not musicRunning then
		return "{\"ok\":false,\"reason\":\"not_running\"}"
	end if
	tell application "Music"
		set playerStateText to (player state as text)
		if playerStateText is "stopped" then
			return "{\"ok\":true,\"state\":\"stopped\",\"hasSong\":false}"
		end if
		try
			set trackTitle to name of current track
			set trackArtist to artist of current track
			set trackAlbum to album of current track
			set trackDuration to duration of current track
			set trackPosition to player position
			set trackId to (database ID of current track) as text
			set escapedTitle to my jsonEscape(trackTitle)
			set escapedArtist to my jsonEscape(trackArtist)
			set escapedAlbum to my jsonEscape(trackAlbum)
			return "{\"ok\":true,\"state\":\"" & playerStateText & "\",\"hasSong\":true,\"id\":\"" & trackId & "\",\"title\":\"" & escapedTitle & "\",\"artist\":\"" & escapedArtist & "\",\"album\":\"" & escapedAlbum & "\",\"duration\":" & trackDuration & ",\"position\":" & trackPosition & "}"
		on error
			return "{\"ok\":true,\"state\":\"" & playerStateText & "\",\"hasSong\":false}"
		end try
	end tell
end snapshotJson

repeat
	try
		log my snapshotJson()
	on error errMsg
		log "{\"ok\":false,\"reason\":\"" & my jsonEscape(errMsg) & "\"}"
	end try
	-- 0.5s is enough; Folia extrapolates between PlayerProgress pushes.
	delay 0.5
end repeat
