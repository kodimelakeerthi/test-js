// Define HTML templates as strings
const dialogTemplate = `
<div style="width: 400px;">
    <form #editDeviceForm="ngForm" [formGroup]="vm.editDeviceFormGroup" (ngSubmit)="vm.save()">
        <mat-toolbar fxLayout="row" color="primary">
            <h2>Edit Device Telemetry</h2>
            <span fxFlex></span>
            <button mat-icon-button (click)="vm.cancel()" type="button">
                <mat-icon class="material-icons">close</mat-icon>
            </button>
        </mat-toolbar>
        
        <mat-progress-bar color="warn" mode="indeterminate" *ngIf="vm.isLoading">
        </mat-progress-bar>
        <div style="height: 4px;" *ngIf="!vm.isLoading"></div>
        
        <div mat-dialog-content>
            <div class="mat-padding" fxLayout="column">
                <mat-form-field class="mat-block">
                    <mat-label>Device name</mat-label>
                    <input matInput formControlName="deviceName" readonly>
                </mat-form-field>
                
                <div *ngIf="vm.latestTelemetry" class="mat-block">
                    <p>Current Value: {{vm.latestTelemetry.value}}</p>
                    <p>Timestamp: {{vm.latestTelemetry.ts | date:'medium'}}</p>
                </div>
                
                <mat-form-field class="mat-block">
                    <mat-label>New Value</mat-label>
                    <input type="number" step="any" matInput formControlName="telemetryValue">
                    <mat-error *ngIf="vm.editDeviceFormGroup?.get('telemetryValue')?.hasError('required')">
                        Value is required.
                    </mat-error>
                </mat-form-field>
            </div>  
        </div>
        
        <div mat-dialog-actions fxLayout="row">
            <span fxFlex></span>
            <button mat-button color="primary"
                    type="button"
                    [disabled]="vm.isLoading"
                    (click)="vm.cancel()" 
                    cdkFocusInitial>
                Cancel
            </button>
            <button mat-button mat-raised-button color="primary"
                    style="margin-right: 20px;"
                    type="submit"
                    [disabled]="vm.isLoading || !vm.editDeviceFormGroup?.valid || !editDeviceForm.dirty">
                Update
            </button>
        </div>
    </form>
</div>
`;

const widgetTemplate = `
<div class="tb-card-button" fxFlex fxLayout="column" fxLayoutAlign="center center">
    <button mat-raised-button color="primary" (click)="vm.openEditDialog($event)">
        Edit Telemetry
    </button>
</div>
`;

// Dialog controller
const saveDeviceTelemetryDialog = {
    controller: function ($scope, $mdDialog, $injector, entityId, widgetContext) {
        var vm = this;
        
        // Initialize scope variables
        vm.entityId = entityId;
        vm.widgetContext = widgetContext;
        vm.isLoading = false;
        vm.device = null;
        vm.telemetryKey = 'temperature';
        vm.telemetryValue = null;
        vm.latestTelemetry = null;
        vm.jwtToken = null;
        
        // Get services
        const deviceService = $injector.get('deviceService');
        const telemetryService = $injector.get('telemetryWebsocket');
        const authService = $injector.get('authService');
        const http = $injector.get('http');
        
        // Initialize form
        vm.editDeviceFormGroup = new widgetContext.ngCore.FormGroup({
            deviceName: new widgetContext.ngCore.FormControl(''),
            telemetryValue: new widgetContext.ngCore.FormControl(null, [widgetContext.ngCore.Validators.required])
        });
        
        // Dialog functions
        vm.cancel = function() {
            $mdDialog.cancel();
        };
        
        vm.save = function() {
            if (!vm.jwtToken) {
                refreshJwtToken(() => saveTelemetry());
                return;
            }
            saveTelemetry();
        };
        
        function refreshJwtToken(callback) {
            authService.refreshJwtToken().subscribe(
                (token) => {
                    vm.jwtToken = token;
                    if (callback) callback();
                },
                (error) => {
                    console.error('Error refreshing JWT token:', error);
                }
            );
        }
        
        function saveTelemetry() {
            vm.isLoading = true;
            
            const telemetryData = {
                ts: Date.now(),
                values: {
                    [vm.telemetryKey]: vm.editDeviceFormGroup.get('telemetryValue').value
                }
            };
            
            const url = `/api/plugins/telemetry/${vm.entityId.entityType}/${vm.entityId.id}/timeseries/ANY`;
            
            const headers = {
                'Content-Type': 'application/json',
                'X-Authorization': `Bearer ${vm.jwtToken}`
            };
            
            http.post(url, telemetryData, { headers }).subscribe(
                () => {
                    vm.isLoading = false;
                    vm.widgetContext.updateAliases();
                    $mdDialog.hide();
                },
                (err) => {
                    vm.isLoading = false;
                    if (err.status === 401) {
                        refreshJwtToken(() => saveTelemetry());
                    } else {
                        console.error('Error saving telemetry:', err);
                    }
                }
            );
        }
        
        function getEntityInfo() {
            vm.isLoading = true;
            
            deviceService.getDevice(vm.entityId.id).subscribe(
                (device) => {
                    vm.device = device;
                    refreshJwtToken(() => getLatestTelemetry());
                },
                (error) => {
                    vm.isLoading = false;
                    console.error('Error getting device:', error);
                }
            );    
        }
        
        function getLatestTelemetry() {
            const timeWindow = {
                startTs: moment().subtract(1, 'minute').valueOf(),
                endTs: moment().valueOf()
            };

            telemetryService.getEntityTimeseries(
                vm.entityId,
                [vm.telemetryKey],
                timeWindow
            ).subscribe(
                (timeseriesData) => {
                    vm.isLoading = false;
                    if (timeseriesData && timeseriesData[vm.telemetryKey] && 
                        timeseriesData[vm.telemetryKey].length > 0) {
                        vm.latestTelemetry = timeseriesData[vm.telemetryKey][timeseriesData[vm.telemetryKey].length - 1];
                        
                        vm.editDeviceFormGroup.patchValue({
                            deviceName: vm.device.name,
                            telemetryValue: vm.latestTelemetry.value
                        }, {emitEvent: false});
                    }
                },
                (error) => {
                    vm.isLoading = false;
                    console.error('Error getting telemetry:', error);
                }
            );
        }
        
        // Initialize token refresh interval
        const tokenRefreshInterval = setInterval(() => {
            refreshJwtToken();
        }, 5 * 60 * 1000);
        
        // Cleanup on destroy
        $scope.$on('$destroy', () => {
            clearInterval(tokenRefreshInterval);
        });
        
        // Start loading data
        getEntityInfo();
    },
    controllerAs: 'vm'
};

// Widget initialization
self.onInit = function() {
    const $injector = widgetContext.$scope.$injector;
    const $mdDialog = $injector.get('$mdDialog');
    const $compile = $injector.get('$compile');
    const $rootScope = $injector.get('$rootScope');
    
    // Create widget controller
    var vm = {
        openEditDialog: function($event) {
            $mdDialog.show({
                controller: saveDeviceTelemetryDialog.controller,
                controllerAs: saveDeviceTelemetryDialog.controllerAs,
                template: dialogTemplate,
                parent: angular.element(document.body),
                targetEvent: $event,
                clickOutsideToClose: true,
                fullscreen: false,
                locals: {
                    entityId: entityId,
                    widgetContext: widgetContext
                }
            }).then(
                function success() {
                    console.log('Dialog closed successfully');
                    widgetContext.updateAliases();
                },
                function fail() {
                    console.log('Dialog closed/cancelled');
                }
            );
        }
    };

    // Compile and inject the widget template
    var element = angular.element(widgetTemplate);
    var compiledElement = $compile(element)({
        vm: vm,
        $scope: widgetContext.$scope
    });
    
    var containerElement = widgetContext.$container[0];
    containerElement.innerHTML = '';
    containerElement.appendChild(compiledElement[0]);
    
    return vm;
};
