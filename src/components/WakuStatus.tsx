import { useState } from 'react';
import { Wifi, WifiOff, AlertCircle, Activity, Users, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface WakuStatusProps {
  connectionStatus: 'connected' | 'disconnected' | 'minimal';
  isConnected: boolean;
  connectionStats?: {
    totalConnections: number;
    connectedCount: number;
    connections: {
      calendarId: string;
      isConnected: boolean;
      status: 'disconnected' | 'connected' | 'minimal';
    }[];
  };
}

export function WakuStatus({ 
  connectionStatus, 
  isConnected, 
  connectionStats
}: WakuStatusProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'connected':
        return <Wifi className="h-4 w-4 text-green-500" />;
      case 'minimal':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
      default:
        return <WifiOff className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'Connected';
      case 'minimal':
        return 'Limited';
      default:
        return 'Disconnected';
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-500';
      case 'minimal':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const handleShowDetails = () => {
    setIsDetailsOpen(true);
  };

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Waku Network Status
          </CardTitle>
          <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleShowDetails}>
                <Info className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Connection Details</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {connectionStats ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Total Connections</Label>
                        <p className="text-2xl font-bold">{connectionStats.totalConnections}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Active Connections</Label>
                        <p className="text-2xl font-bold">{connectionStats.connectedCount}</p>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div>
                      <Label className="text-sm font-medium mb-2 block">Calendar Connections</Label>
                      <div className="space-y-2">
                        {connectionStats.connections.map((conn, index) => (
                          <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                            <span className="text-sm font-mono">{conn.calendarId}</span>
                            <Badge variant={conn.isConnected ? "default" : "secondary"}>
                              {conn.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">No connection statistics available.</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon()}
            <span className="text-sm font-medium">{getStatusText()}</span>
            <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          </div>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {connectionStats ? `${connectionStats.connectedCount}/${connectionStats.totalConnections}` : "No data"}
          </Badge>
        </div>

        {isConnected && connectionStats && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Calendars:</span>
                <span className="font-medium">{connectionStats.totalConnections}</span>
              </div>
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Active:</span>
                <span className="font-medium">{connectionStats.connectedCount}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}