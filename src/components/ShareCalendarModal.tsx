import { useState } from 'react';
import { Copy, Check, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/hooks/use-toast';
import { WakuSingleNodeManager } from '@/lib/wakuSingleNode';

interface ShareCalendarModalProps {
  calendarId: string;
  calendarName: string;
  isPrivate: boolean;
  isShared: boolean;
  onPrivateToggle: (isPrivate: boolean) => void;
  onUnshare: () => void;
  connectionStatus: 'connected' | 'disconnected' | 'minimal';
  isConnected: boolean;
  onInitializeWaku: (calendarId: string, encryptionKey?: string) => void;
}

export function ShareCalendarModal({
  calendarId,
  calendarName,
  isPrivate,
  isShared,
  onPrivateToggle,
  onUnshare,
  connectionStatus,
  isConnected,
  onInitializeWaku
}: ShareCalendarModalProps) {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [encryptionKey] = useState(() => 
    isPrivate ? btoa(`${calendarId}-${Date.now()}`).substring(0, 16) : undefined
  );

  const shareUrl = new WakuSingleNodeManager().generateShareUrl(calendarId, calendarName, encryptionKey);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
      toast({
        title: "Share link copied!",
        description: "The calendar share link has been copied to your clipboard."
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Could not copy the share link to clipboard.",
        variant: "destructive"
      });
    }
  };

  const handleShareCalendar = async () => {
    if (!isConnected) {
      onInitializeWaku(calendarId, isPrivate ? encryptionKey : undefined);
      // Auto-copy URL after enabling sharing
      setTimeout(async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast({
            title: "Share link copied!",
            description: "Calendar sharing enabled and link copied to clipboard."
          });
        } catch (error) {
          toast({
            title: "Sharing enabled",
            description: "Calendar sharing is now active. Historical data has been synchronized."
          });
        }
      }, 2000); // Wait a bit longer for sync to complete
    }
  };

  const getConnectionIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-accent" />;
      case 'minimal':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <WifiOff className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getConnectionText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected to Waku Network';
      case 'minimal':
        return 'Limited connection to Waku Network';
      default:
        return 'Disconnected from Waku Network';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Configure Sharing for "{calendarName}"
            {getConnectionIcon()}
          </CardTitle>
          <CardDescription>
            {getConnectionText()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isShared ? (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  This calendar is currently being shared. You can copy the share link or stop sharing.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="share-url">Share URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="share-url"
                      value={shareUrl}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyUrl}
                      className="shrink-0"
                    >
                      {copiedUrl ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {isPrivate && encryptionKey && (
                    <p className="text-xs text-muted-foreground">
                      This URL contains an encryption key. Anyone with this link can view your calendar.
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={onUnshare} 
                    variant="destructive"
                    className="flex-1"
                  >
                    Stop Sharing
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <h4 className="text-sm font-medium mb-2">How it works:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Events are synchronized in real-time via Waku Network</li>
                    <li>• Changes from any participant are instantly shared</li>
                    <li>• No central server required - fully decentralized</li>
                    {isPrivate && <li>• End-to-end encrypted for privacy</li>}
                  </ul>
                </div>
              </div>
            </>
          ) : (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Enable sharing to allow others to view and collaborate on this calendar.
                </AlertDescription>
              </Alert>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="private-toggle">Private Calendar</Label>
                    <p className="text-sm text-muted-foreground">
                      Private calendars are encrypted and require the share link to access
                    </p>
                  </div>
                  <Switch
                    id="private-toggle"
                    checked={isPrivate}
                    onCheckedChange={onPrivateToggle}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="share-url">Share URL (Preview)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="share-url"
                      value={shareUrl}
                      readOnly
                      className="font-mono text-sm opacity-60"
                    />
                  </div>
                  {isPrivate && encryptionKey && (
                    <p className="text-xs text-muted-foreground">
                      This URL will contain an encryption key. Anyone with this link will be able to view your calendar.
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleShareCalendar} 
                    className="flex-1"
                  >
                    Enable Sharing
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <h4 className="text-sm font-medium mb-2">How it works:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Events will be synchronized in real-time via Waku Network</li>
                    <li>• Changes from any participant will be instantly shared</li>
                    <li>• No central server required - fully decentralized</li>
                    {isPrivate && <li>• End-to-end encrypted for privacy</li>}
                  </ul>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}