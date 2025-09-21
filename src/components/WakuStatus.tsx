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
  nodeStats: {
    peerCount: number;
    isHealthy: boolean;
    protocolsSupported: string[];
    startTime: number;
  };
  onGetDetailedInfo: () => Promise<any>;
}

export function WakuStatus({ 
  connectionStatus, 
  isConnected, 
  nodeStats,
  onGetDetailedInfo
}: WakuStatusProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailedInfo, setDetailedInfo] = useState<any>(null);

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

  const formatUptime = (startTime: number) => {
    const uptimeMs = Date.now() - startTime;
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  };

  const handleShowDetails = async () => {
    const info = await onGetDetailedInfo();
    setDetailedInfo(info);
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
                <DialogTitle>Detailed Node Information</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {detailedInfo ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Peer ID</Label>
                        <p className="text-xs font-mono text-muted-foreground break-all">
                          {detailedInfo.peerId}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Channel ID</Label>
                        <p className="text-xs font-mono text-muted-foreground">
                          {detailedInfo.channelId}
                        </p>
                      </div>
                    </div>
                    
                    <Separator />
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Connected Peers</Label>
                        <p className="text-2xl font-bold">{detailedInfo.peerCount}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Connections</Label>
                        <p className="text-2xl font-bold">{detailedInfo.connectionCount}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Uptime</Label>
                        <p className="text-2xl font-bold">{formatUptime(nodeStats.startTime)}</p>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <Label className="text-sm font-medium mb-2 block">Supported Protocols</Label>
                      <div className="flex flex-wrap gap-1">
                        {detailedInfo.protocols.map((protocol: string, index: number) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {protocol}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {detailedInfo.connectedPeers.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <Label className="text-sm font-medium mb-2 block">Connected Peers</Label>
                          <div className="max-h-32 overflow-y-auto space-y-1">
                            {detailedInfo.connectedPeers.map((peer: string, index: number) => (
                              <p key={index} className="text-xs font-mono text-muted-foreground break-all">
                                {peer}
                              </p>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">Loading node information...</p>
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
          <Badge variant={nodeStats.isHealthy ? "default" : "secondary"}>
            {nodeStats.isHealthy ? "Healthy" : "Unhealthy"}
          </Badge>
        </div>

        {isConnected && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Peers:</span>
                <span className="font-medium">{nodeStats.peerCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Uptime:</span>
                <span className="font-medium">{formatUptime(nodeStats.startTime)}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}